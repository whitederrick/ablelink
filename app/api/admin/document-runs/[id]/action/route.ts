// app/api/admin/document-runs/[id]/action/route.ts
// 매니저 문서 액션: confirm(확정) / sign(매니저 서명) / request-changes(수정요청).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit } from "@/lib/audit";

const DOC_LABEL: Record<string, string> = {
  ATTENDANCE_SHEET:              "출근부",
  TRAINING_DAILY_LOG:            "지원고용 훈련일지",
  TRAINEE_COMPREHENSIVE_EVAL:    "훈련생 종합평가",
  POST_EMPLOY_ADAPT_LOG:         "적응지도 일지",
  ADAPTATION_COMPREHENSIVE_EVAL: "적응지도 종합평가",
  CHECKLIST:                     "체크리스트",
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const runId = BigInt(id);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { id: true, agencyId: true, workerId: true, traineeId: true, signStage: true, docType: true, periodStart: true, periodEnd: true },
    });
    if (!run) return NextResponse.json({ success: false, message: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (run.agencyId !== scope.agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const now = new Date();

    // 문서 식별 라벨(승인/수정요청 알림 공용): 문서명(+훈련생) · 기간
    const docLabel = DOC_LABEL[run.docType] ?? run.docType;
    let traineeName = "";
    if (run.traineeId != null) {
      const t = await prisma.trainee.findUnique({ where: { id: run.traineeId }, select: { name: true } });
      traineeName = t?.name ? `(${t.name})` : "";
    }
    const docTitle = `${docLabel}${traineeName} · ${run.periodStart.toISOString().slice(0, 10)}~${run.periodEnd.toISOString().slice(0, 10)}`;

    if (action === "confirm") {
      await prisma.documentRun.update({ where: { id: runId }, data: { signStage: "CONFIRMED" } });
      // 워커에게 승인(확정) 알림 — 반려만 알리던 비대칭 해소.
      try {
        await prisma.workerNotice.create({
          data: {
            workerId: run.workerId,
            agencyId: run.agencyId,
            title: `[승인] ${docTitle}`,
            body: `제출하신 문서가 승인(확정)되었습니다.\n\n■ 문서: ${docTitle}`,
            type: "INFO",
            kind: "NOTICE_INDIVIDUAL",
            link: "/worker/docs",
          },
        });
      } catch (e) { console.warn("[document-runs confirm] 워커 알림 실패:", e); }
      await audit(scope, { entityType: "DocumentRun", entityId: runId, action: "update", before: { signStage: run.signStage }, after: { signStage: "CONFIRMED" } });
      return NextResponse.json({ success: true, signStage: "CONFIRMED" });
    }

    if (action === "sign") {
      const mgr = await prisma.manager.findUnique({ where: { id: scope.managerId }, select: { signatureUrl: true, displayName: true } });
      if (!mgr?.signatureUrl)
        return NextResponse.json({ success: false, message: "등록된 매니저 서명이 없습니다. '내 서명' 메뉴에서 먼저 서명을 등록해주세요.", needSignature: true }, { status: 400 });
      await prisma.documentRun.update({
        where: { id: runId },
        data: {
          managerSignatureUrl: mgr.signatureUrl,
          managerSignerName: mgr.displayName ?? "",
          managerSignedAt: now,
          signStage: "MANAGER_SIGNED",
        },
      });
      await audit(scope, { entityType: "DocumentRun", entityId: runId, action: "update", before: { signStage: run.signStage }, after: { signStage: "MANAGER_SIGNED" } });
      return NextResponse.json({ success: true, signStage: "MANAGER_SIGNED" });
    }

    if (action === "request-changes") {
      const reason = String(body?.reason || "").trim();
      await prisma.documentRun.update({ where: { id: runId }, data: { signStage: "CHANGES_REQUESTED" } });

      await prisma.workerNotice.create({
        data: {
          workerId: run.workerId,
          agencyId: run.agencyId,
          title: `[수정요청] ${docTitle}`,
          body: `다음 문서의 수정이 필요합니다.\n\n■ 문서: ${docTitle}\n■ 사유: ${reason || "(사유 미입력)"}\n\n해당 문서를 수정 후 다시 제출해주세요.`,
          type: "WARN",
          kind: "NOTICE_INDIVIDUAL",
          link: "/worker/docs",
        },
      });
      await audit(scope, { entityType: "DocumentRun", entityId: runId, action: "update", before: { signStage: run.signStage }, after: { signStage: "CHANGES_REQUESTED" } });
      return NextResponse.json({ success: true, signStage: "CHANGES_REQUESTED" });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/[id]/action]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
