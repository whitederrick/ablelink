// app/api/admin/system/managers/route.ts
// 시스템 운영자 전용: 전체 위탁기관 관리자(Manager) 목록 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const managers = await prisma.manager.findMany({
      include: { agency: { select: { id: true, name: true } } },
      orderBy: [{ agencyId: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({
      success: true,
      managers: managers.map(m => ({
        id:          m.id.toString(),
        loginId:     m.loginId,
        displayName: m.displayName,
        isActive:    m.isActive,
        lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
        createdAt:   m.createdAt.toISOString(),
        agencyId:    m.agency?.id.toString() ?? null,
        agencyName:  m.agency?.name ?? "-",
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/managers GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
