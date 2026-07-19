// 시스템 운영자 전용: 어드민 계정 수정/비밀번호 초기화/비활성화
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import { generateTempPassword } from "@/lib/tempPassword";
import bcrypt from "bcryptjs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdminSession(req);

    const { id } = await params;
    const adminId = parseBigInt(id);
    if (!adminId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const body = await req.json();
    const { action, newPassword, displayName, isActive, agencyId, email, phone, note } = body;

    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) return NextResponse.json({ success: false, message: "계정을 찾을 수 없습니다." }, { status: 404 });

    if (action === "reset-password") {
      // ★임시 비밀번호를 서버가 생성해 응답에 담아 화면에 표시(워커 초기화와 동일 UX 통일).
      //  관리자가 직접 타이핑(마스킹)해 '뭘로 바뀌는지 안 보이던' 비일관 제거. newPassword가 오면 존중(하위호환).
      const tempPassword = (typeof newPassword === "string" && newPassword.length >= 8) ? newPassword : generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      // #5(17차): 비번 초기화 시 sessionVersion +1 → 발급된 모든 기존 JWT 무효화(탈취 세션 회수). 워커와 동일.
      await prisma.admin.update({ where: { id: admin.id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
      return NextResponse.json({ success: true, message: "임시 비밀번호가 발급되었습니다.", tempPassword });
    }

    if (action === "toggle-active") {
      await prisma.admin.update({ where: { id: admin.id }, data: { isActive: !admin.isActive } });
      return NextResponse.json({ success: true, message: admin.isActive ? "계정이 비활성화되었습니다." : "계정이 활성화되었습니다." });
    }

    if (action === "update") {
      const updateData: any = {};
      if (displayName !== undefined) updateData.displayName = displayName?.trim() || null;
      if (email !== undefined)       updateData.email = email?.trim() || null;
      if (phone !== undefined)       updateData.phone = phone?.trim() || null;
      if (note !== undefined)        updateData.note = note?.trim() || null;
      if (isActive !== undefined)    updateData.isActive = isActive;
      if (agencyId !== undefined) {
        if (agencyId && !/^[0-9]+$/.test(String(agencyId))) return NextResponse.json({ success: false, message: "잘못된 위탁기관 ID입니다." }, { status: 400 });
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
