// 매니저 콘솔용 시스템 공지 조회 (운영자가 발송한 SystemAnnouncement를 매니저가 열람).
// 운영자 전용 발송/관리는 /api/admin/system/announcements (requireAdminSession) 유지.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);

    const rows = await prisma.systemAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, body: true, type: true, createdAt: true },
    });
    const reads = await prisma.systemAnnouncementRead.findMany({
      where: { managerId: scope.managerId, announcementId: { in: rows.map(r => r.id) } },
      select: { announcementId: true },
    });
    const readSet = new Set(reads.map(r => r.announcementId.toString()));

    const announcements = rows.map((a) => ({
      id: a.id.toString(),
      title: a.title,
      body: a.body,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
      read: readSet.has(a.id.toString()),
    }));

    return NextResponse.json({
      success: true,
      announcements,
      unreadCount: announcements.filter(a => !a.read).length,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/announcements GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

// 읽음(확인) 처리: { id } 단건, 또는 { all: true } 전체.
export async function POST(req: Request) {
  try {
    const scope = await requireManagerSession(req);
    const b = await req.json().catch(() => ({}));
    let ids: bigint[] = [];
    if (b?.all === true) {
      const rows = await prisma.systemAnnouncement.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true } });
      ids = rows.map(r => r.id);
    } else if (b?.id != null && /^\d+$/.test(String(b.id))) {
      ids = [BigInt(String(b.id))];
    }
    if (ids.length === 0) return NextResponse.json({ success: false, message: "대상 없음" }, { status: 400 });
    await prisma.systemAnnouncementRead.createMany({
      data: ids.map(announcementId => ({ announcementId, managerId: scope.managerId })),
      skipDuplicates: true,
    });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/announcements POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
