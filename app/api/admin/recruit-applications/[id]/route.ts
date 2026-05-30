// app/api/admin/recruit-applications/[id]/route.ts
// 신청 수락/반려 (공고 등록 주체만). 수락 = 매칭 성사 → 향후 worker 연계/배정의 트리거 지점.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdminOrManagerSession(req);
    const { id } = await params;
    const appId = parseBigInt(id);
    if (!appId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const b = await req.json();
    const action = String(b.action ?? "");
    if (!["accept", "reject"].includes(action)) {
      return NextResponse.json({ success: false, message: "action은 accept 또는 reject여야 합니다." }, { status: 400 });
    }

    const app = await prisma.recruitApplication.findUnique({
      where: { id: appId },
      include: { post: true },
    });
    if (!app) return NextResponse.json({ success: false, message: "신청을 찾을 수 없습니다." }, { status: 404 });

    const owned =
      session.kind === "manager"
        ? app.post.createdByManagerId === session.managerId || app.post.agencyId === session.agencyId
        : app.post.createdByAdminId === session.adminId;
    if (!owned) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (app.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "이미 처리된 신청입니다." }, { status: 409 });
    }

    await prisma.recruitApplication.update({
      where: { id: appId },
      data: { status: action === "accept" ? "ACCEPTED" : "REJECTED", decidedAt: new Date() },
    });

    // 직무지도원에게 알림(매칭 결과) — WorkerNotice.agencyId 필수라 에이전시 공고일 때만
    if (app.post.agencyId) {
      try {
        await prisma.workerNotice.create({
          data: {
            workerId: app.workerId,
            agencyId: app.post.agencyId,
            title: action === "accept" ? "[직무지도 매칭] 신청이 수락되었습니다" : "[직무지도 매칭] 신청 결과 안내",
            body:
              action === "accept"
                ? `'${app.post.companyName}' 직무지도 신청이 수락되었습니다. 담당자 연락 또는 배정 절차가 진행됩니다.`
                : `'${app.post.companyName}' 직무지도 신청이 이번에는 반영되지 않았습니다.`,
            type: "INFO",
          },
        });
      } catch { /* 알림 실패는 비치명적 */ }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[recruit-applications/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
