// 매니저 콘솔용 시스템 공지 조회 (운영자가 발송한 SystemAnnouncement를 매니저가 열람).
// 운영자 전용 발송/관리는 /api/admin/system/announcements (requireAdminSession) 유지.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    await requireManagerSession(req);

    const rows = await prisma.systemAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, body: true, type: true, createdAt: true },
    });

    return NextResponse.json({
      success: true,
      announcements: rows.map((a) => ({
        id: a.id.toString(),
        title: a.title,
        body: a.body,
        type: a.type,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/announcements GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
