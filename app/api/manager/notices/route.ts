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

    // 통합 피드: 개별 알림(ManagerNotice) + 운영자 시스템공지(SystemAnnouncement, 매니저별 읽음=SystemAnnouncementRead).
    //  시스템공지는 관계 없이 별도 조회 후 SystemAnnouncementRead 로 읽음상태 병합(가상 병합 — fan-out 미사용).
    // F1: 미읽음 배지·목록 정확도.
    //  · 정렬 `readAt: asc`는 Postgres에서 NULL(미읽음)을 뒤로 보내(nulls last) take:50 창에서 미읽음이 잘려나가
    //    "미읽음 먼저" 주석과 반대로 동작 → 배지 0·목록 누락. `nulls: "first"`로 미읽음을 창 앞으로.
    //  · 미읽음 개수는 창 절단과 무관하게 별도 count 쿼리로 정확히 집계(F1/F2).
    const [notices, sysAnnouncements, sysReads, unreadNotice, totalSys, sysReadCount] = await Promise.all([
      prisma.managerNotice.findMany({
        where: { managerId },
        orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
        take: 50,
        select: { id: true, ticketId: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      prisma.systemAnnouncement.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, title: true, body: true, type: true, createdAt: true },
      }),
      prisma.systemAnnouncementRead.findMany({ where: { managerId }, select: { announcementId: true, readAt: true } }),
      prisma.managerNotice.count({ where: { managerId, readAt: null } }),
      prisma.systemAnnouncement.count(),
      prisma.systemAnnouncementRead.count({ where: { managerId } }),
    ]);

    const readMap = new Map(sysReads.map(r => [r.announcementId.toString(), r.readAt]));

    const noticeItems = notices.map(n => ({
      id:        n.id.toString(),
      source:    "notice" as const,
      ticketId:  n.ticketId?.toString() ?? null,
      title:     n.title,
      body:      n.body,
      link:      (n as any).link ?? null,
      readAt:    n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));

    const sysLabel = (t: string) => (t === "URGENT" ? "긴급 공지" : t === "MAINTENANCE" ? "점검 안내" : "시스템 공지");
    const sysItems = sysAnnouncements.map(a => {
      const rd = readMap.get(a.id.toString());
      return {
        id:        `sys:${a.id}`,
        source:    "system" as const,
        ticketId:  null,
        title:     `[${sysLabel(a.type)}] ${a.title}`,
        body:      a.body,
        link:      "/manager/system-notices",
        readAt:    rd ? rd.toISOString() : null,
        createdAt: a.createdAt.toISOString(),
      };
    });

    // 미읽음 우선, 그다음 최신순 — 개별알림 정렬과 동일 기준으로 통합.
    const merged = [...noticeItems, ...sysItems].sort((x, y) => {
      const xu = x.readAt ? 1 : 0, yu = y.readAt ? 1 : 0;
      if (xu !== yu) return xu - yu;
      return y.createdAt.localeCompare(x.createdAt);
    });

    // F2: 시스템공지 미읽음 = 전체 공지 − 이 매니저가 읽은 공지 수(take:50 창 밖 오래된 미읽음도 정확히 집계).
    const unreadSys = Math.max(0, totalSys - sysReadCount);

    return NextResponse.json({
      success: true,
      unreadCount: unreadNotice + unreadSys,
      notices: merged,
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
      // 시스템 공지도 전부 읽음 처리(관계 없어 수동 diff → 미읽음만 read 레코드 생성).
      const [allSys, reads] = await Promise.all([
        prisma.systemAnnouncement.findMany({ select: { id: true }, orderBy: { createdAt: "desc" }, take: 200 }),
        prisma.systemAnnouncementRead.findMany({ where: { managerId }, select: { announcementId: true } }),
      ]);
      const readSet = new Set(reads.map(r => r.announcementId.toString()));
      const toMark = allSys.filter(a => !readSet.has(a.id.toString()));
      if (toMark.length > 0) {
        await prisma.systemAnnouncementRead.createMany({
          data: toMark.map(a => ({ announcementId: a.id, managerId })),
          skipDuplicates: true,
        });
      }
      return NextResponse.json({ success: true });
    }

    // 시스템 공지 읽음(id="sys:<announcementId>") — SystemAnnouncementRead upsert.
    if (typeof body?.noticeId === "string" && body.noticeId.startsWith("sys:")) {
      const aid = parseBigInt(body.noticeId.slice(4));
      if (!aid) return NextResponse.json({ success: false, message: "noticeId가 필요합니다." }, { status: 400 });
      await prisma.systemAnnouncementRead.upsert({
        where: { announcementId_managerId: { announcementId: aid, managerId } },
        create: { announcementId: aid, managerId },
        update: {},
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
