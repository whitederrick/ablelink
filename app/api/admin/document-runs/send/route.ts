// app/api/admin/document-runs/send/route.ts
// 일지 관리 '문서 발송' — 선택한 제출문서(DocumentRun)의 최종본 PDF를 묶어
// 장애인고용공단 담당자 이메일로 발송. 묶음 단위: 현장별 / 직무지도원별 / 전체 1통.
//
// 흐름: 직무지도원 → 위탁기관(매니저) → 장애인고용공단.
// 수신자는 설정(Agency.govContactEmail) 기본값 + 발송 시 수정 가능(클라이언트가 to 전달).

export const runtime = "nodejs";

import { getKstDateString } from "@/lib/time";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";
import { PRISMA_TO_PDF_DOCTYPE } from "@/lib/docs/docTypeMap";
import { injectManagerSignature } from "@/lib/docs/managerSig";
import { missingSignatureLabels } from "@/lib/docs/requiredSignatures";
import { sendEmailWithAttachments } from "@/lib/email";
import { logAccess } from "@/lib/accessLog";
import { mapWithConcurrency } from "@/lib/concurrency";

const DOC_LABEL: Record<string, string> = {
  ATTENDANCE_SHEET:              "출근부",
  TRAINING_DAILY_LOG:            "지원고용훈련일지",
  TRAINEE_COMPREHENSIVE_EVAL:    "훈련생종합평가",
  POST_EMPLOY_ADAPT_LOG:         "적응지도일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도종합평가",
  CHECKLIST:                     "체크리스트",
};

function safe(s: string) { return (s || "").replace(/[\\/:*?"<>|]/g, "").trim(); }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const body = await req.json().catch(() => ({}));

    // 복수 수신자 허용(쉼표/세미콜론 구분) — 공단 담당자 여러 명에게 동시 발송
    const toList = String(body?.to || "").split(/[,;]/).map(s => s.trim()).filter(Boolean);
    const groupBy = (["site", "worker", "none"].includes(body?.groupBy) ? body.groupBy : "site") as "site" | "worker" | "none";
    const message = String(body?.message || "").trim();
    // 현장별 공단 담당자 자동 수신처(현장 묶음 전용) — 각 현장의 govContacts(없으면 기관 기본값)로 발송
    const useSiteContacts = body?.useSiteContacts === true;
    const idsRaw: unknown = body?.ids;
    if (useSiteContacts) {
      if (groupBy !== "site") return NextResponse.json({ success: false, message: "현장별 공단 담당자 발송은 '현장' 묶음에서만 가능합니다." }, { status: 400 });
      if (toList.length && !toList.every(e => EMAIL_RE.test(e))) return NextResponse.json({ success: false, message: "추가 수신자 이메일 형식이 올바르지 않습니다." }, { status: 400 });
    } else {
      if (toList.length === 0 || !toList.every(e => EMAIL_RE.test(e))) return NextResponse.json({ success: false, message: "유효한 수신자 이메일을 입력해주세요. (여러 명은 쉼표로 구분)" }, { status: 400 });
    }
    if (toList.length > 20) return NextResponse.json({ success: false, message: "수신자는 최대 20명까지 지정할 수 있습니다." }, { status: 400 });
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) return NextResponse.json({ success: false, message: "발송할 문서를 선택해주세요." }, { status: 400 });

    const ids = idsRaw.map(String).filter(s => /^\d+$/.test(s)).map(s => BigInt(s));
    if (ids.length === 0) return NextResponse.json({ success: false, message: "발송할 문서를 선택해주세요." }, { status: 400 });
    if (ids.length > 50) return NextResponse.json({ success: false, message: "한 번에 최대 50건까지 발송할 수 있습니다." }, { status: 400 });

    const runs = await prisma.documentRun.findMany({
      // 공단 발송 대상: DRAFT(미제출)·CHANGES_REQUESTED(수정요청 중)는 제외 — 수정요청 문서가 그대로 발송되지 않도록.
      where: { id: { in: ids }, agencyId: scope.agencyId, signStage: { notIn: ["DRAFT", "CHANGES_REQUESTED"] } },
      orderBy: [{ siteId: "asc" }, { workerId: "asc" }, { periodStart: "asc" }],
      select: {
        id: true, docType: true, traineeId: true, periodStart: true, periodEnd: true,
        managerSignatureUrl: true, managerSignerName: true,
        worker: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true, govContacts: true } },
        currentVersion: { select: { sourceData: true } },
      },
    });
    if (runs.length === 0) return NextResponse.json({ success: false, message: "발송 가능한 문서가 없습니다." }, { status: 404 });

    const agency = await prisma.agency.findUnique({ where: { id: scope.agencyId }, select: { name: true, govContacts: true } });
    const agencyName = agency?.name ?? "위탁기관";
    // 기관 기본 공단 담당자 이메일(현장별 미설정 시 폴백)
    const agencyGovEmails = (Array.isArray(agency?.govContacts) ? agency!.govContacts as any[] : [])
      .map(c => String(c?.email ?? "").trim()).filter(e => EMAIL_RE.test(e));

    // 훈련생 이름
    const traineeIds = [...new Set(runs.map(r => r.traineeId).filter((v): v is bigint => v != null))];
    const trainees = traineeIds.length
      ? await prisma.trainee.findMany({ where: { id: { in: traineeIds } }, select: { id: true, name: true } })
      : [];
    const traineeMap = new Map(trainees.map(t => [t.id.toString(), t.name]));

    // ── 발송 게이트(매니저→공단): 선택 문서 중 필수 서명이 하나라도 누락이면 전체 발송 차단 + 경고 ──
    //   직무지도원/사업체 담당자 서명은 제출 스냅샷에서, 매니저 서명은 run.managerSignatureUrl(명시 sign)로 점검.
    const sigBlockers: string[] = [];
    for (const r of runs) {
      const who = r.traineeId != null ? (traineeMap.get(r.traineeId.toString()) ?? "") : (r.worker?.workerName ?? "");
      const ps = getKstDateString(r.periodStart);
      const pe = getKstDateString(r.periodEnd);
      const lacks = missingSignatureLabels(r.docType, r.currentVersion?.sourceData, r.managerSignatureUrl);
      if (lacks.length) {
        sigBlockers.push(`· ${DOC_LABEL[r.docType] ?? r.docType}${who ? `(${who})` : ""} ${ps}~${pe} — ${lacks.join("·")} 서명 누락`);
      }
    }
    if (sigBlockers.length) {
      return NextResponse.json(
        {
          success: false,
          code: "MISSING_SIGNATURES",
          message: `서명이 누락된 문서가 있어 공단 발송할 수 없습니다.\n모든 서명을 등록한 뒤 다시 시도해주세요.\n\n${sigBlockers.join("\n")}`,
        },
        { status: 400 },
      );
    }

    // 묶음 그룹핑
    type Run = (typeof runs)[number];
    const groups = new Map<string, { label: string; runs: Run[] }>();
    for (const r of runs) {
      let key: string, label: string;
      if (groupBy === "site")        { key = r.site?.id.toString() ?? "none"; label = r.site?.companyName ?? "현장미상"; }
      else if (groupBy === "worker") { key = r.worker?.id.toString() ?? "none"; label = r.worker?.workerName ?? "직무지도원미상"; }
      else                           { key = r.id.toString(); label = `${DOC_LABEL[r.docType] ?? r.docType}`; }
      if (!groups.has(key)) groups.set(key, { label, runs: [] });
      groups.get(key)!.runs.push(r);
    }

    let sent = 0;
    const failures: string[] = [];
    const sentRunIds: bigint[] = []; // 발송 성공한 문서 → 공단 제출완료 자동 기록

    for (const { label, runs: grpRuns } of groups.values()) {
      const usedNames = new Set<string>();
      const attachments: { filename: string; content: Buffer }[] = [];
      const groupRunIds: bigint[] = [];
      // 렌더는 무거우므로 동시성 상한(4)으로 병렬 처리 — 순서는 보존해 파일명 번호 부여를 결정적으로 유지.
      const renderedBufs = await mapWithConcurrency(grpRuns, 4, async (r) => {
        if (!r.currentVersion?.sourceData) return null;
        const renderType = (PRISMA_TO_PDF_DOCTYPE[r.docType] ?? r.docType) as DocumentType;
        const basePayload = {
          ...((r.currentVersion.sourceData ?? {}) as any),
          companyName: (r.currentVersion.sourceData as any)?.companyName ?? r.site?.companyName ?? "",
        };
        const payload = await injectManagerSignature(basePayload, {
          managerSignatureUrl: r.managerSignatureUrl,
          managerSignerName: r.managerSignerName,
        });
        try {
          return await renderPdfToBuffer({ documentType: renderType, payload });
        } catch (e) {
          console.error("[document-runs/send render]", r.id.toString(), e);
          return null;
        }
      });
      // 파일명 부여·첨부는 순차(중복 번호 결정적).
      for (let gi = 0; gi < grpRuns.length; gi++) {
        const r = grpRuns[gi];
        const buf = renderedBufs[gi];
        if (!buf) continue;
        const docLabel = DOC_LABEL[r.docType] ?? r.docType;
        const who = r.traineeId != null ? (traineeMap.get(r.traineeId.toString()) ?? "") : safe(r.worker?.workerName ?? "");
        const ps = getKstDateString(r.periodStart);
        const pe = getKstDateString(r.periodEnd);
        let name = `${safe(docLabel)}_${safe(who)}_${ps}_${pe}.pdf`;
        let i = 2;
        while (usedNames.has(name)) { name = `${safe(docLabel)}_${safe(who)}_${ps}_${pe}_${i++}.pdf`; }
        usedNames.add(name);
        attachments.push({ filename: name, content: buf });
        groupRunIds.push(r.id);
      }

      if (attachments.length === 0) { failures.push(label); continue; }

      // 수신처 결정: 현장별 자동이면 현장 govContacts(없으면 기관 기본값) + 추가 수신자, 아니면 입력한 toList.
      let recipients = toList;
      if (useSiteContacts) {
        const siteGov = (Array.isArray(grpRuns[0]?.site?.govContacts) ? grpRuns[0].site!.govContacts as any[] : [])
          .map(c => String(c?.email ?? "").trim()).filter(e => EMAIL_RE.test(e));
        const base = siteGov.length ? siteGov : agencyGovEmails;
        recipients = [...new Set([...base, ...toList])];
        if (recipients.length === 0) { failures.push(`${label}(수신처 없음)`); continue; }
      }

      const subject = `[Able-Link] ${agencyName} 제출문서 — ${label} (${attachments.length}건)`;
      const text =
        (message ? `${message}\n\n` : "") +
        `■ 위탁기관: ${agencyName}\n` +
        `■ 묶음: ${label}\n` +
        `■ 첨부 문서: ${attachments.length}건\n\n` +
        `Able-Link에서 발송된 메일입니다.`;
      try {
        await sendEmailWithAttachments({ to: recipients, subject, body: text, attachments });
        sent++;
        sentRunIds.push(...groupRunIds);
      } catch (e: any) {
        console.error("[document-runs/send email]", label, e);
        failures.push(label);
      }
    }

    // 발송 성공 문서 → 공단 제출완료 자동 기록(재제출요구였던 것도 다시 제출완료로)
    if (sentRunIds.length) {
      await prisma.documentRun.updateMany({
        where: { id: { in: sentRunIds }, agencyId: scope.agencyId },
        data: { govStatus: "SUBMITTED", govSubmittedAt: new Date(), govSubmitCount: { increment: 1 } },
      });
    }

    // M10: 개인정보 접속기록(안전성확보조치 제8조) — 공단(제3자) 발송은 최다·최민감 PII 제공 지점인데
    //  라우트별 수동 삽입 방식이라 여기가 통째로 누락돼 있었다. 발송 성공 문서의 정보주체(워커)별로 export 기록.
    const sentSet = new Set(sentRunIds.map(id => id.toString()));
    const sentWorkers = new Map<string, string | null>();
    for (const r of runs) {
      if (!sentSet.has(r.id.toString()) || !r.worker) continue;
      sentWorkers.set(r.worker.id.toString(), r.worker.workerName ?? null);
    }
    await Promise.all([...sentWorkers].map(([wid, wname]) =>
      logAccess(req, scope, {
        subjectType: "Worker",
        subjectId: BigInt(wid),
        subjectLabel: wname,
        resource: "official_document_gov_send",
        action: "export",
      }),
    ));

    if (sent === 0) {
      return NextResponse.json({ success: false, message: `발송에 실패했습니다.${failures.length ? ` (${failures.join(", ")})` : ""}` }, { status: 502 });
    }
    return NextResponse.json({
      success: true,
      sent,
      message: `${sent}건의 메일을 발송했습니다.${failures.length ? ` (실패: ${failures.join(", ")})` : ""}`,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/send]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
