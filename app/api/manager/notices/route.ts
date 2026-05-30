// GET  — 매니저 알림 목록 (최신순, 미읽음 먼저)
// POST — 알림 읽음 처리 { noticeId: string } 또는 { all: true }
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const { managerId } = await requireManagerSession(req);

    const notices = await prisma.managerNotice.findMany({
      where: { managerId },
      orderBy: [{ readAt: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id:        true,
        ticketId:  true,
        title:     true,
        body:      true,
        readAt:    true,
        createdAt: true,
      },
    });

    const unreadCount = notices.filter(n => !n.readAt).length;

    return NextResponse.json({
      success: true,
      unreadCount,
      notices: notices.map(n => ({
        id:        n.id.toString(),
        ticketId:  n.ticketId?.toString() ?? null,
        title:     n.title,
        body:      n.body,
        readAt:    n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { managerId } = await requireManagerSession(req);

    const body = await req.json().catch(() => ({}));
    const now = new Date();

    if (body?.all === true) {
      await prisma.managerNotice.updateMany({
        where: { managerId, readAt: null },
        data: { readAt: now },
      });
      return NextResponse.json({ success: true });
    }

    const noticeId = parseBigInt(body?.noticeId);
    if (!noticeId) {
      return NextResponse.json({ success: false, message: "noticeId가 필요합니다." }, { status: 400 });
    }

    const notice = await prisma.managerNotice.findUnique({ where: { id: noticeId } });
    if (!notice || notice.managerId !== managerId) {
      return NextResponse.json({ success: false, message: "알림을 찾을 수 없습니다." }, { status: 404 });
    }

    await prisma.managerNotice.update({ where: { id: noticeId }, data: { readAt: now } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
