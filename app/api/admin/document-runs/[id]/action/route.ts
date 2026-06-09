// app/api/admin/document-runs/[id]/action/route.ts
// 매니저 문서 액션: confirm(확정) / sign(매니저 서명) / request-changes(수정요청).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const runId = BigInt(id);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    const run = await prisma.documentRun.findUnique({
      where: { id: runId },
      select: { id: true, agencyId: true, workerId: true, signStage: true, docType: true, periodStart: true, periodEnd: true },
    });
    if (!run) return NextResponse.json({ success: false, message: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (run.agencyId !== scope.agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const now = new Date();

    if (action === "confirm") {
      await prisma.documentRun.update({ where: { id: runId }, data: { signStage: "CONFIRMED" } });
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
      return NextResponse.json({ success: true, signStage: "MANAGER_SIGNED" });
    }

    if (action === "request-changes") {
      const reason = String(body?.reason || "").trim();
      await prisma.documentRun.update({ where: { id: runId }, data: { signStage: "CHANGES_REQUESTED" } });
      // 직무지도원에게 수정요청 알림 + 딥링크
      await (prisma as any).workerNotice.create({
        data: {
          workerId: run.workerId,
          agencyId: run.agencyId,
          title: "[문서 수정요청] 제출 문서 수정이 필요합니다",
          body: reason || "제출하신 문서에 수정이 필요합니다. 내용을 수정 후 다시 제출해주세요.",
          type: "WARN",
          kind: "NOTICE_INDIVIDUAL",
          link: "/worker/docs",
        },
      });
      return NextResponse.json({ success: true, signStage: "CHANGES_REQUESTED" });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/document-runs/[id]/action]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
