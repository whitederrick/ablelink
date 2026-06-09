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

    const body = await req.json().catch(() => ({}));
    const { periodStart, periodEnd, documents, companyManagerSignToken } = body;

    if (!periodStart || !periodEnd || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd))
      return NextResponse.json({ success: false, message: "기간(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
    if (!Array.isArray(documents) || documents.length === 0)
      return NextResponse.json({ success: false, message: "제출할 문서가 없습니다." }, { status: 400 });

    const pStart = new Date(`${periodStart}T00:00:00.000+09:00`);
    const pEnd   = new Date(`${periodEnd}T23:59:59.999+09:00`);
    const now = new Date();

    const submitted: { docType: string; traineeName: string | null; versionNo: number }[] = [];
    let workerName = "";
    let ownerManagerId: bigint | null = null;

    for (const d of documents) {
      const docType = String(d?.docType || "");
      const traineeId = d?.traineeId ?? null;

      let built;
      try {
        built = await buildDocPayload({ workerId, docType, periodStart, periodEnd, traineeId, companyManagerSignToken });
      } catch (e: any) {
        if (e instanceof DocPayloadError)
          return NextResponse.json({ success: false, message: `${DOC_LABELS[docType] || docType}: ${e.message}`, ...(e.extra || {}) }, { status: e.status });
        throw e;
      }
      const { payload, meta } = built;
      workerName = meta.workerName;

      const res = await prisma.$transaction(async (tx) => {
        const site = await tx.site.findUnique({ where: { id: meta.siteId }, select: { agencyId: true, ownerManagerId: true } });

        // DocumentRun upsert(현장×문서종류×기간×훈련생) — nullable traineeId 때문에 findFirst+create.
        let run = await tx.documentRun.findFirst({
          where: { assignmentId: meta.assignmentId, docType: docType as any, periodStart: pStart, traineeId: meta.traineeId },
          select: { id: true },
        });
        if (!run) {
          run = await tx.documentRun.create({
            data: {
              agencyId: site?.agencyId ?? null,
              assignment: { connect: { id: meta.assignmentId } },
              site: { connect: { id: meta.siteId } },
              worker: { connect: { id: workerId } },
              traineeId: meta.traineeId,
              docType: docType as any,
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
          data: { currentVersion: { connect: { id: version.id } }, signStage: "SUBMITTED", workerSignedAt: now },
        });

        await tx.documentSubmissionLog.create({
          data: {
            run: { connect: { id: run.id } },
            version: { connect: { id: version.id } },
            stage: DocumentStage.FINAL,
            submittedByUser: { connect: { id: workerId } },
          },
        });

        return { versionNo: version.versionNo, ownerManagerId: site?.ownerManagerId ?? null };
      });

      ownerManagerId = res.ownerManagerId;
      submitted.push({ docType, traineeName: meta.traineeName, versionNo: res.versionNo });
    }

    // 담당 매니저 알림 — 무엇을 제출했는지 + 재제출(버전업) 표시
    if (ownerManagerId) {
      const lines = submitted.map(s =>
        `· ${DOC_LABELS[s.docType] || s.docType}${s.traineeName ? `(${s.traineeName})` : ""}${s.versionNo > 1 ? ` — 수정본 v${s.versionNo}` : ""}`
      ).join("\n");
      const anyUpdate = submitted.some(s => s.versionNo > 1);
      await prisma.managerNotice.create({
        data: {
          managerId: ownerManagerId,
          title: `[문서 ${anyUpdate ? "재" : ""}제출] ${workerName} · ${periodStart}~${periodEnd}`,
          body: `${workerName} 직무지도원이 아래 문서를 제출했습니다.\n\n${lines}`,
        },
      });
    }

    return NextResponse.json({ success: true, submitted: submitted.length });
  } catch (e: any) {
    console.error("[worker/docs/submit]", e);
    return NextResponse.json({ success: false, message: e.message || "제출 오류" }, { status: 500 });
  }
}
