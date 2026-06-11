// app/api/admin/document-runs/send/route.ts
// 일지 관리 '문서 발송' — 선택한 제출문서(DocumentRun)의 최종본 PDF를 묶어
// 장애인고용공단 담당자 이메일로 발송. 묶음 단위: 현장별 / 직무지도원별 / 전체 1통.
//
// 흐름: 직무지도원 → 위탁기관(매니저) → 장애인고용공단.
// 수신자는 설정(Agency.govContactEmail) 기본값 + 발송 시 수정 가능(클라이언트가 to 전달).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { renderPdfToBuffer, type DocumentType } from "@/lib/pdf";
import { PRISMA_TO_PDF_DOCTYPE } from "@/lib/docs/docTypeMap";
import { injectManagerSignature } from "@/lib/docs/managerSig";
import { sendEmailWithAttachments } from "@/lib/email";

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

    const to = String(body?.to || "").trim();
    const groupBy = (["site", "worker", "none"].includes(body?.groupBy) ? body.groupBy : "site") as "site" | "worker" | "none";
    const message = String(body?.message || "").trim();
    const idsRaw: unknown = body?.ids;
    if (!EMAIL_RE.test(to)) return NextResponse.json({ success: false, message: "유효한 수신자 이메일을 입력해주세요." }, { status: 400 });
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) return NextResponse.json({ success: false, message: "발송할 문서를 선택해주세요." }, { status: 400 });

    const ids = idsRaw.map(String).filter(s => /^\d+$/.test(s)).map(s => BigInt(s));
    if (ids.length === 0) return NextResponse.json({ success: false, message: "발송할 문서를 선택해주세요." }, { status: 400 });
    if (ids.length > 50) return NextResponse.json({ success: false, message: "한 번에 최대 50건까지 발송할 수 있습니다." }, { status: 400 });

    const runs = await prisma.documentRun.findMany({
      where: { id: { in: ids }, agencyId: scope.agencyId, signStage: { not: "DRAFT" } },
      orderBy: [{ siteId: "asc" }, { workerId: "asc" }, { periodStart: "asc" }],
      select: {
        id: true, docType: true, traineeId: true, periodStart: true, periodEnd: true,
        managerSignatureUrl: true, managerSignerName: true,
        worker: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true } },
        currentVersion: { select: { sourceData: true } },
      },
    });
    if (runs.length === 0) return NextResponse.json({ success: false, message: "발송 가능한 문서가 없습니다." }, { status: 404 });

    const agency = await prisma.agency.findUnique({ where: { id: scope.agencyId }, select: { name: true } });
    const agencyName = agency?.name ?? "위탁기관";

    // 훈련생 이름
    const traineeIds = [...new Set(runs.map(r => r.traineeId).filter((v): v is bigint => v != null))];
    const trainees = traineeIds.length
      ? await prisma.trainee.findMany({ where: { id: { in: traineeIds } }, select: { id: true, name: true } })
      : [];
    const traineeMap = new Map(trainees.map(t => [t.id.toString(), t.name]));

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
      for (const r of grpRuns) {
        if (!r.currentVersion?.sourceData) continue;
        const renderType = (PRISMA_TO_PDF_DOCTYPE[r.docType] ?? r.docType) as DocumentType;
        const basePayload = {
          ...((r.currentVersion.sourceData ?? {}) as any),
          companyName: (r.currentVersion.sourceData as any)?.companyName ?? r.site?.companyName ?? "",
        };
        const payload = await injectManagerSignature(basePayload, {
          managerSignatureUrl: r.managerSignatureUrl,
          managerSignerName: r.managerSignerName,
        });
        let buf: Buffer;
        try {
          buf = await renderPdfToBuffer({ documentType: renderType, payload });
        } catch (e) {
          console.error("[document-runs/send render]", r.id.toString(), e);
          continue;
        }
        const docLabel = DOC_LABEL[r.docType] ?? r.docType;
        const who = r.traineeId != null ? (traineeMap.get(r.traineeId.toString()) ?? "") : safe(r.worker?.workerName ?? "");
        const ps = r.periodStart.toISOString().slice(0, 10);
        const pe = r.periodEnd.toISOString().slice(0, 10);
        let name = `${safe(docLabel)}_${safe(who)}_${ps}_${pe}.pdf`;
        let i = 2;
        while (usedNames.has(name)) { name = `${safe(docLabel)}_${safe(who)}_${ps}_${pe}_${i++}.pdf`; }
        usedNames.add(name);
        attachments.push({ filename: name, content: buf });
        groupRunIds.push(r.id);
      }

      if (attachments.length === 0) { failures.push(label); continue; }

      const subject = `[AbleLink] ${agencyName} 제출문서 — ${label} (${attachments.length}건)`;
      const text =
        (message ? `${message}\n\n` : "") +
        `■ 위탁기관: ${agencyName}\n` +
        `■ 묶음: ${label}\n` +
        `■ 첨부 문서: ${attachments.length}건\n\n` +
        `AbleLink에서 발송된 메일입니다.`;
      try {
        await sendEmailWithAttachments({ to, subject, body: text, attachments });
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
        data: { govStatus: "SUBMITTED", govSubmittedAt: new Date() },
      });
    }

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
