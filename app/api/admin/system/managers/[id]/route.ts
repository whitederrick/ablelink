// app/api/admin/system/managers/[id]/route.ts
// 시스템 운영자 전용: 위탁기관 관리자(Manager 로그인) 활성/비활성 토글
// PATCH { isActive: boolean }

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdminSession(req);

    const { id } = await params;
    const managerId = parseBigInt(id);
    if (!managerId) {
      return NextResponse.json({ success: false, message: "잘못된 관리자 ID입니다." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    if (typeof body?.isActive !== "boolean") {
      return NextResponse.json({ success: false, message: "isActive(boolean)가 필요합니다." }, { status: 400 });
    }

    const existing = await prisma.manager.findUnique({ where: { id: managerId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ success: false, message: "관리자를 찾을 수 없습니다." }, { status: 404 });
    }

    const updated = await prisma.manager.update({
      where: { id: managerId },
      data: { isActive: body.isActive },
      select: { id: true, isActive: true },
    });

    return NextResponse.json({ success: true, id: String(updated.id), isActive: updated.isActive });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/managers/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
