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
    const [notices, sysAnnouncements, unreadNotice, allSysRows] = await Promise.all([
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
      prisma.managerNotice.count({ where: { managerId, readAt: null } }),
      // M5: 미읽음 계산은 '현재 존재하는 공지 id' 목록 기준(시스템공지는 저빈도라 전량 id 조회 저렴).
      prisma.systemAnnouncement.findMany({ select: { id: true } }),
    ]);

    // F3: 긴급(URGENT) 공지는 50창 밖으로 밀려도 미읽음이면 노출(aging out 방지).
    //  fan-out(per-manager 레코드)은 816324f에서 중복 때문에 제거했으므로 재도입하지 않고,
    //  긴급 공지를 별도 조회 → 읽지 않은 것만 병합(중복은 id로 dedup). 집계는 F2(전체-읽음)로 이미 정확.
    const urgentRecent = await prisma.systemAnnouncement.findMany({
      where: { type: "URGENT" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true, body: true, type: true, createdAt: true },
    });
    const shownSysIds = new Set(sysAnnouncements.map(a => a.id.toString()));
    const extraUrgent = urgentRecent.filter(u => !shownSysIds.has(u.id.toString()));

    // F4: 읽음행 조회를 '표시 대상 공지(최근 50 + 긴급)'로 한정(60초 폴링에서 전체 읽음행 무제한 전송 방지).
    const readScanIds = [...sysAnnouncements.map(a => a.id), ...extraUrgent.map(a => a.id)];
    const sysReads = await prisma.systemAnnouncementRead.findMany({
      where: { managerId, announcementId: { in: readScanIds } },
      select: { announcementId: true, readAt: true },
    });
    const readMap = new Map(sysReads.map(r => [r.announcementId.toString(), r.readAt]));
    // 최근 50 전체 + (창 밖) 긴급 중 '미읽음'만 목록에 병합.
    const shownSys = [...sysAnnouncements, ...extraUrgent.filter(u => !readMap.has(u.id.toString()))];

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
    const sysItems = shownSys.map(a => {
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

    // F2+M5: 시스템공지 미읽음 = 존재하는 공지 − 그중 읽은 공지 수.
    //  ★읽음수를 '현재 존재하는 공지 id'로 스코프해야 정확 — 삭제된 공지의 읽음행(FK/cascade 없음)이 남아
    //   전역 읽음수를 부풀리면 미읽음이 0으로 낮춰져 실제 미읽음 긴급공지를 놓치던 버그(M5) 해소.
    const allSysIds = allSysRows.map(a => a.id);
    const sysReadForExisting = allSysIds.length
      ? await prisma.systemAnnouncementRead.count({ where: { managerId, announcementId: { in: allSysIds } } })
      : 0;
    const unreadSys = Math.max(0, allSysIds.length - sysReadForExisting);

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
      // 시스템 공지도 전부 읽음 처리. F5: @@unique([announcementId, managerId]) + skipDuplicates가 이미 중복을
      //  걸러주므로 기존 읽음행을 미리 조회·diff 할 필요 없이 전체 id로 createMany 하면 된다(쿼리 1회 감소).
      const allSys = await prisma.systemAnnouncement.findMany({ select: { id: true }, orderBy: { createdAt: "desc" }, take: 200 });
      if (allSys.length > 0) {
        await prisma.systemAnnouncementRead.createMany({
          data: allSys.map(a => ({ announcementId: a.id, managerId })),
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
