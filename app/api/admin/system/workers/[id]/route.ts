// 시스템 운영자 전용: 직무지도원 계정 관리 (상태 변경, 비밀번호 초기화)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
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
      // ★비밀번호 초기화 = 전 세션 로그아웃(sv+1). 셀프 재설정(reset-password)과 동일 정책(P2-16).
      // ★10차#3: 관리자가 지정한 known 비번 → hasKnownPassword=true(서명 분기가 덮어쓰지 않도록).
      await prisma.worker.update({ where: { id: user.id }, data: { password: hashedPassword, hasKnownPassword: true, sessionVersion: { increment: 1 } } });
      await audit(scope, { entityType: "Worker", entityId: user.id, action: "update", summary: "비밀번호 초기화" });
      return NextResponse.json({ success: true, message: "비밀번호가 초기화되었습니다." });
    }

    if (action === "set-status") {
      const validStatuses = ["ACTIVE", "RESIGNED", "PAUSED"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ success: false, message: "유효하지 않은 상태입니다." }, { status: 400 });
      }
      await prisma.worker.update({ where: { id: user.id }, data: { status } });
      await audit(scope, { entityType: "Worker", entityId: user.id, action: "update", summary: memo ? `상태 변경 (사유: ${memo})` : undefined, before: { status: user.status }, after: { status } });
      return NextResponse.json({ success: true, message: `상태가 ${status}로 변경되었습니다.` });
    }

    // 운영자 개인 구독 부여/회수 (위탁기관 계약과 무관한 직접 권한 — 초기 영업·특례용)
    // 등급 단위 개통(2026-06-06): FREE/STARTER/STANDARD/PRO/PREMIUM 중 선택.
    if (action === "set-plan") {
      const plan = String(body.planType ?? "");
      const validPlans = ["FREE", "STARTER", "STANDARD", "PRO", "PREMIUM"];
      if (!validPlans.includes(plan)) {
        return NextResponse.json({ success: false, message: "planType은 FREE/STARTER/STANDARD/PRO/PREMIUM 중 하나여야 합니다." }, { status: 400 });
      }
      await prisma.worker.update({ where: { id: user.id }, data: { planType: plan as any } });
      await audit(scope, { entityType: "Worker", entityId: user.id, action: "update", summary: memo ? `구독 변경 (사유: ${memo})` : undefined, before: { planType: user.planType }, after: { planType: plan } });
      const msg = plan === "FREE" ? "개인 구독이 회수되었습니다." : `개인 구독(${plan})이 부여되었습니다.`;
      return NextResponse.json({ success: true, message: msg });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
