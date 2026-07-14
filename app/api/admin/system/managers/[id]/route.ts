// app/api/admin/system/managers/[id]/route.ts
// 시스템 운영자 전용: 위탁기관 관리자(Manager 로그인) 관리
//  PATCH { isActive: boolean }                      — 활성/비활성 토글(하위호환: 위탁기관 상세 모달)
//  PATCH { action: "toggle-active" }                — 활성/비활성 토글
//  PATCH { action: "reset-password", newPassword }  — 비밀번호 초기화
//  PATCH { action: "update", displayName }          — 담당자명 수정

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";
import bcrypt from "bcryptjs";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdminSession(req);

    const { id } = await params;
    const managerId = parseBigInt(id);
    if (!managerId) {
      return NextResponse.json({ success: false, message: "잘못된 관리자 ID입니다." }, { status: 400 });
    }

    const existing = await prisma.manager.findUnique({ where: { id: managerId }, select: { id: true, isActive: true } });
    if (!existing) {
      return NextResponse.json({ success: false, message: "관리자를 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    // 비밀번호 초기화
    if (action === "reset-password") {
      const newPassword = String(body?.newPassword ?? "");
      if (newPassword.length < 8) {
        return NextResponse.json({ success: false, message: "비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
      }
      // #5(17차): 비번 초기화 시 sessionVersion +1 → 발급된 모든 기존 JWT 무효화(탈취 세션 회수). 워커와 동일.
      await prisma.manager.update({ where: { id: managerId }, data: { passwordHash: await bcrypt.hash(newPassword, 12), sessionVersion: { increment: 1 } } });
      return NextResponse.json({ success: true, message: "비밀번호가 초기화되었습니다." });
    }

    // 담당자명 수정
    if (action === "update") {
      const displayName = body?.displayName != null ? String(body.displayName).trim() || null : null;
      await prisma.manager.update({ where: { id: managerId }, data: { displayName } });
      return NextResponse.json({ success: true, message: "관리자 정보가 저장되었습니다." });
    }

    // 활성/비활성 토글
    const nextActive =
      typeof body?.isActive === "boolean" ? body.isActive :
      action === "toggle-active" ? !existing.isActive :
      null;
    if (nextActive === null) {
      return NextResponse.json({ success: false, message: "처리할 작업이 없습니다." }, { status: 400 });
    }

    const updated = await prisma.manager.update({
      where: { id: managerId },
      data: { isActive: nextActive },
      select: { id: true, isActive: true },
    });
    return NextResponse.json({ success: true, id: String(updated.id), isActive: updated.isActive, message: updated.isActive ? "활성화되었습니다." : "비활성화되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/managers/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
