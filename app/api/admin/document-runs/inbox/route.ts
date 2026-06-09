// app/api/admin/document-runs/inbox/route.ts
// 매니저 문서 허브: 직무지도원이 제출한 문서(DocumentRun) 한 곳 조회.
// signStage 가 DRAFT 가 아닌(=제출 이상) 건만. 직무지도원/현장/훈련생/문서/기간/상태/버전.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { PRISMA_TO_PDF_DOCTYPE } from "@/lib/docs/docTypeMap";

const DOC_LABEL: Record<string, string> = {
  ATTENDANCE_SHEET:              "출근부",
  TRAINING_DAILY_LOG:            "지원고용 훈련일지",
  TRAINEE_COMPREHENSIVE_EVAL:    "훈련생 종합평가",
  POST_EMPLOY_ADAPT_LOG:         "적응지도 일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
  CHECKLIST:                     "체크리스트",
};

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    const runs = await prisma.documentRun.findMany({
      where: {
        agencyId: scope.agencyId,
        signStage: { not: "DRAFT" },
        ...(q ? { OR: [
          { worker: { workerName: { contains: q } } },
          { site: { companyName: { contains: q } } },
        ] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 300,
      select: {
        id: true,
        docType: true,
        traineeId: true,
        periodStart: true,
        periodEnd: true,
        signStage: true,
        workerSignedAt: true,
        managerSignedAt: true,
        currentVersionId: true,
        updatedAt: true,
        worker: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true } },
        currentVersion: { select: { versionNo: true } },
        _count: { select: { versions: true } },
      },
    });

    // 훈련생 이름 일괄 조회
    const traineeIds = [...new Set(runs.map(r => r.traineeId).filter((v): v is bigint => v != null))];
    const trainees = traineeIds.length
      ? await prisma.trainee.findMany({ where: { id: { in: traineeIds } }, select: { id: true, name: true } })
      : [];
    const traineeMap = new Map(trainees.map(t => [t.id.toString(), t.name]));

    const items = runs.map(r => ({
      id: r.id.toString(),
      docType: r.docType,
      docTypeRender: PRISMA_TO_PDF_DOCTYPE[r.docType] ?? r.docType,
      docLabel: DOC_LABEL[r.docType] ?? r.docType,
      traineeName: r.traineeId != null ? (traineeMap.get(r.traineeId.toString()) ?? "-") : null,
      workerId: r.worker?.id.toString() ?? "",
      workerName: r.worker?.workerName ?? "-",
      siteId: r.site?.id.toString() ?? "",
      siteName: r.site?.companyName ?? "-",
      periodStart: r.periodStart.toISOString().slice(0, 10),
      periodEnd: r.periodEnd.toISOString().slice(0, 10),
      signStage: r.signStage,
      submittedAt: r.workerSignedAt?.toISOString() ?? null,
      managerSignedAt: r.managerSignedAt?.toISOString() ?? null,
      currentVersionId: r.currentVersionId?.toString() ?? null,
      versionNo: r.currentVersion?.versionNo ?? null,
      versionCount: r._count.versions,
      updatedAt: r.updatedAt.toISOString(),
    }));

    return NextResponse.json({ success: true, items });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/inbox]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
