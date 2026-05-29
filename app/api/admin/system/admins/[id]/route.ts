// 시스템 운영자 전용: 어드민 계정 수정/비밀번호 초기화/비활성화
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import bcrypt from "bcryptjs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const adminId = parseBigInt(id);
    if (!adminId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const body = await req.json();
    const { action, newPassword, displayName, isActive, agencyId } = body;

    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) return NextResponse.json({ success: false, message: "계정을 찾을 수 없습니다." }, { status: 404 });

    if (action === "reset-password") {
      if (!newPassword || newPassword.length < 8) {
        return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
      }
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash } });
      return NextResponse.json({ success: true, message: "비밀번호가 초기화되었습니다." });
    }

    if (action === "toggle-active") {
      await prisma.admin.update({ where: { id: admin.id }, data: { isActive: !admin.isActive } });
      return NextResponse.json({ success: true, message: admin.isActive ? "계정이 비활성화되었습니다." : "계정이 활성화되었습니다." });
    }

    if (action === "update") {
      const updateData: any = {};
      if (displayName !== undefined) updateData.displayName = displayName?.trim() || null;
      if (isActive !== undefined)    updateData.isActive = isActive;
      if (agencyId !== undefined) {
        updateData.agencyId = agencyId ? BigInt(agencyId) : null;
        if (agencyId) {
          const ag = await prisma.agency.findUnique({ where: { id: BigInt(agencyId) }, select: { name: true } });
          updateData.agencyName = ag?.name ?? null;
        } else {
          updateData.agencyName = null;
        }
      }
      await prisma.admin.update({ where: { id: admin.id }, data: updateData });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: "알 수 없는 action" }, { status: 400 });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
