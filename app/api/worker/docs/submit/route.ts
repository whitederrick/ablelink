// app/api/worker/docs/submit/route.ts
// 직무지도원 문서 "최종 제출(발송)" — 기간 묶음.
// 각 문서: DocumentRun upsert + DocumentVersion(sourceData 스냅샷·자동 버전업) + SubmissionLog
//          + signStage=SUBMITTED. 완료 후 담당 매니저에게 ManagerNotice 알림.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { DocumentStage } from "@prisma/client";
import { buildDocPayload, DocPayloadError } from "@/lib/docs/buildDocPayload";
import { PDF_TO_PRISMA_DOCTYPE } from "@/lib/docs/docTypeMap";
import { checkRateLimit } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";

const MAX_VERSIONS_PER_RUN = 20; // 보존: run당 최근 N개 버전만 유지(과도 누적·PII 적재 방지)

const DOC_LABELS: Record<string, string> = {
  ATTENDANCE_SHEET:      "출근부",
  TRAINING_DAILY_LOG:    "지원고용 훈련일지",
  TRAINEE_FINAL_EVAL:    "훈련생 종합평가",
  ADAPTATION_DAILY_LOG:  "적응지도 일지",
  ADAPTATION_FINAL_EVAL: "적응지도 종합평가",
};

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
    const workerId = BigInt(session.workerId);

    // 레이트리밋(남용·버전 폭주 방지)
    const rl = await checkRateLimit(`doc-submit:${session.workerId}`);
    if (!rl.allowed) return NextResponse.json({ success: false, message: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });

    const body = await req.json().catch(() => ({}));
    const { periodStart, periodEnd, documents, companyManagerSignToken, assignmentId } = body;

    if (!periodStart || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd))
      return NextResponse.json({ success: false, message: "기간(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
    if (!Array.isArray(documents) || documents.length === 0)
      return NextResponse.json({ success: false, message: "제출할 문서가 없습니다." }, { status: 400 });

    const pStart = new Date(`${periodStart}T00:00:00.000+09:00`);
    const pEnd   = new Date(`${periodEnd}T23:59:59.999+09:00`);
    const now = new Date();

    const submitted: { docType: string; traineeName: string | null; versionNo: number }[] = [];
    let workerName = "";
    let agencyIdForNotice: bigint | null = null;
    const runIds: bigint[] = [];

    for (const d of documents) {
      const docType = String(d?.docType || "");
      const traineeId = d?.traineeId ?? null;

      let built;
      try {
        built = await buildDocPayload({ workerId, docType, periodStart, periodEnd, traineeId, companyManagerSignToken, assignmentId });
      } catch (e: any) {
        if (e instanceof DocPayloadError)
          return NextResponse.json({ success: false, message: `${DOC_LABELS[docType] || docType}: ${e.message}`, ...(e.extra || {}) }, { status: e.status });
        throw e;
      }
      const { payload, meta } = built;
      workerName = meta.workerName;

      // 훈련생 소속 검증은 buildDocPayload 내부 findTraineeAtSiteInPeriod(현장+문서기간 재적)로 이미 수행됨.
      //  M11: 여기서 trainee.currentSiteId===meta.siteId(현재시점 스냅샷)를 재검사하면, 이달 타현장으로 이동한
      //   훈련생의 '지난달' 문서가 generate/preview는 성공하는데 submit만 403나는 수정요청 재제출 데드엔드가 됐다.
      //   (이 diff가 도입한 '과거 재적 인원 인정' 기간 의미론을 스스로 무효화하던 것) → 중복·모순 스냅샷 검사 제거.

      // PDF docType → Prisma DocumentType enum (vocabulary 다름)
      const prismaDocType = PDF_TO_PRISMA_DOCTYPE[docType];
      if (!prismaDocType)
        return NextResponse.json({ success: false, message: `지원하지 않는 문서: ${docType}` }, { status: 400 });

      const res = await prisma.$transaction(async (tx) => {
        // ★출근부 등 traineeId=null 문서는 @@unique([assignmentId,docType,periodStart,traineeId])가 NULL을
        //  distinct로 취급(Postgres NULLS DISTINCT)해 findFirst→create 레이스를 못 막는다(동시 제출 시 중복
        //  DocumentRun → 공단 이중 이메일 발송). 문서 정체성으로 advisory 트랜잭션 락을 걸어 동시 제출을 직렬화.
        const lockKey = `docsubmit:${meta.assignmentId}:${prismaDocType}:${periodStart}:${meta.traineeId ?? 0}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        // ★소유권·알림은 assignment.agencyId(실귀속) 기준 — site.agencyId(참고용·공유현장)면 run 인박스 스코프와
        //  알림이 타 기관으로 갈라진다. edit-request/respond와 동일 정합(ownership 불변식).
        const asg = await tx.siteAssignment.findUnique({ where: { id: meta.assignmentId }, select: { agencyId: true } });

        // DocumentRun upsert(현장×문서종류×기간×훈련생) — nullable traineeId 때문에 findFirst+create.
        let run = await tx.documentRun.findFirst({
          where: { assignmentId: meta.assignmentId, docType: prismaDocType, periodStart: pStart, traineeId: meta.traineeId },
          select: { id: true },
        });
        if (!run) {
          run = await tx.documentRun.create({
            data: {
              agencyId: asg?.agencyId ?? null,
              assignment: { connect: { id: meta.assignmentId } },
              site: { connect: { id: meta.siteId } },
              worker: { connect: { id: workerId } },
              traineeId: meta.traineeId,
              docType: prismaDocType,
              periodStart: pStart,
              periodEnd: pEnd,
              openAt: now,
              dueAt: pEnd,
            },
            select: { id: true },
          });
        }

        const maxNo = (await tx.documentVersion.aggregate({ where: { runId: run.id }, _max: { versionNo: true } }))._max.versionNo ?? 0;
        const version = await tx.documentVersion.create({
          data: {
            run: { connect: { id: run.id } },
            versionNo: maxNo + 1,
            stage: DocumentStage.FINAL,
            pdfUrl: "", // sourceData 재생성 방식 — 파일 미저장
            // undefined(서명 imageUrl 등)·BigInt 제거 → Prisma Json 안전
            sourceData: JSON.parse(JSON.stringify(payload)),
            createdByUser: { connect: { id: workerId } },
          },
          select: { id: true, versionNo: true },
        });

        await tx.documentRun.update({
          where: { id: run.id },
          data: {
            currentVersion: { connect: { id: version.id } },
            signStage: "SUBMITTED",
            workerSignedAt: now,
            // P3: 재제출 시 기간종료(periodEnd)도 갱신 — run은 periodStart로만 매칭하므로 기간 연장
            //  재제출 시 구 periodEnd가 남아 문서 기간이 어긋나던 것 보정. (periodStart는 매칭키라 동일.)
            periodEnd: pEnd,
            // 재제출 = 새 내용 버전 → 이전 매니저·기관 서명 무효화(매니저 재검토 전 구 서명이 공단 발송되는 것 방지).
            managerSignatureUrl: null, managerSignedAt: null, managerSignerName: null,
            agencySignatureUrl: null, agencySignedAt: null,
          },
        });

        await tx.documentSubmissionLog.create({
          data: {
            run: { connect: { id: run.id } },
            version: { connect: { id: version.id } },
            stage: DocumentStage.FINAL,
            submittedByUser: { connect: { id: workerId } },
          },
        });

        return { runId: run.id, versionNo: version.versionNo, agencyId: asg?.agencyId ?? null };
      });

      agencyIdForNotice = res.agencyId;
      runIds.push(res.runId);
      submitted.push({ docType, traineeName: meta.traineeName, versionNo: res.versionNo });
    }

    // 보존: run당 오래된 버전(최근 N개 초과)을 정리(과도 누적·PII 적재 방지). best-effort.
    for (const rid of new Set(runIds)) {
      try {
        const old = await prisma.documentVersion.findMany({
          where: { runId: rid },
          orderBy: { versionNo: "desc" },
          select: { id: true },
          skip: MAX_VERSIONS_PER_RUN,
        });
        if (old.length > 0) {
          await prisma.documentVersion.deleteMany({ where: { id: { in: old.map(v => v.id) } } });
        }
      } catch (e) { console.error("[submit version prune]", e); }
    }

    // 알림 대상: 실소속 기관(assignment.agencyId) 활성 매니저 전체(인박스 스코프와 일치·비활성 제외).
    let targetManagerIds: bigint[] = [];
    if (agencyIdForNotice) {
      const mgrs = await prisma.manager.findMany({ where: { agencyId: agencyIdForNotice, isActive: true }, select: { id: true } });
      targetManagerIds = mgrs.map(m => m.id);
    }
    if (targetManagerIds.length > 0) {
      const lines = submitted.map(s =>
        `· ${DOC_LABELS[s.docType] || s.docType}${s.traineeName ? `(${s.traineeName})` : ""}${s.versionNo > 1 ? ` — 수정본 v${s.versionNo}` : ""}`
      ).join("\n");
      const anyUpdate = submitted.some(s => s.versionNo > 1);
      await prisma.managerNotice.createMany({
        data: targetManagerIds.map(mid => ({
          managerId: mid,
          title: `[문서 ${anyUpdate ? "재" : ""}제출] ${workerName} · ${periodStart}~${periodEnd}`,
          body: `${workerName} 직무지도원이 아래 문서를 ${anyUpdate ? "재" : ""}제출했습니다.\n\n${lines}`,
        })),
      });
    }

    await audit(session, { entityType: "DocumentRun", action: "update", summary: `문서 제출 ${submitted.length}건 (${periodStart}~${periodEnd})` });

    return NextResponse.json({ success: true, submitted: submitted.length });
  } catch (e: any) {
    // DB 유니크(문서 중복) 위반 = 동시 제출 레이스 → 중복 생성은 막혔고, 사용자에겐 재시도 안내.
    if (e?.code === "P2002") {
      return NextResponse.json({ success: false, message: "이미 제출 처리 중인 문서입니다. 잠시 후 다시 시도해주세요." }, { status: 409 });
    }
    console.error("[worker/docs/submit]", e);
    return NextResponse.json({ success: false, message: "제출 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
