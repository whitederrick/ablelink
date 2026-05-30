// 시스템 운영자 전용: 직무지도원 계정 관리 (상태 변경, 비밀번호 초기화)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { logAudit } from "@/lib/auditLog";
import bcrypt from "bcryptjs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const workerId = parseBigInt(id);
    if (!workerId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const body = await req.json();
    const { action, newPassword, status, memo } = body;

    const user = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!user) return NextResponse.json({ success: false, message: "직무지도원을 찾을 수 없습니다." }, { status: 404 });

    if (action === "reset-password") {
      if (!newPassword || newPassword.length < 8) {
        return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
      }
      const hashedPassword = await bcrypt.hash(newPassword, 12);
      await prisma.worker.update({ where: { id: user.id }, data: { password: hashedPassword } });
      await logAudit({ adminId: scope.adminId, action: "WORKER_PASSWORD_RESET", target: `User:${user.id}`, detail: { workerName: user.workerName } });
      return NextResponse.json({ success: true, message: "비밀번호가 초기화되었습니다." });
    }

    if (action === "set-status") {
      const validStatuses = ["ACTIVE", "RESIGNED", "PAUSED"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 상태입니다." }, { status: 400 });
      }
      await prisma.worker.update({ where: { id: user.id }, data: { status } });
      await logAudit({ adminId: scope.adminId, action: "WORKER_STATUS_CHANGED", target: `User:${user.id}`, detail: { before: user.status, after: status, memo } });
      return NextResponse.json({ success: true, message: `상태가 ${status}로 변경되었습니다.` });
    }

    // 운영자 개인 구독 부여/회수 (에이전시 계약과 무관한 직접 권한 — 초기 직무지도원 테스트/특례용)
    if (action === "set-plan") {
      const plan = String(body.planType ?? "");
      if (!["FREE", "PREMIUM"].includes(plan)) {
        return NextResponse.json({ success: false, message: "planType은 FREE 또는 PREMIUM이어야 합니다." }, { status: 400 });
      }
      await prisma.worker.update({ where: { id: user.id }, data: { planType: plan as "FREE" | "PREMIUM" } });
      await logAudit({ adminId: scope.adminId, action: "WORKER_PLAN_CHANGED", target: `Worker:${user.id}`, detail: { before: user.planType, after: plan, memo } });
      return NextResponse.json({ success: true, message: plan === "PREMIUM" ? "개인 구독(PREMIUM)이 부여되었습니다." : "개인 구독이 회수되었습니다." });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
