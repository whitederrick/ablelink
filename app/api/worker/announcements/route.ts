// 워커 공지 게시판 — 운영자 시스템 공지 + 소속 위탁기관 공지 병합 열람(읽기 전용).
// (개인 처리필요 알림은 /api/worker/notices 알림함과 별개)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { getWorkerAgencyIds } from "@/lib/recruitVisibility";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const agencyIds = await getWorkerAgencyIds(workerId);

    const [system, agency] = await Promise.all([
      prisma.systemAnnouncement.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, title: true, body: true, type: true, createdAt: true },
      }),
      agencyIds.length
        ? prisma.agencyAnnouncement.findMany({
            where: { agencyId: { in: agencyIds } },
            orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
            take: 30,
            select: { id: true, title: true, body: true, type: true, pinned: true, createdAt: true, category: { select: { name: true, tone: true } } },
          })
        : Promise.resolve([] as any[]),
    ]);

    const items = [
      ...agency.map((a: any) => ({
        id: `A${a.id}`, scope: "AGENCY" as const, scopeLabel: "소속 기관",
        title: a.title, body: a.body, type: a.type,
        categoryName: a.category?.name ?? null, categoryTone: a.category?.tone ?? null,
        pinned: a.pinned, createdAt: a.createdAt.toISOString(),
      })),
      ...system.map((a: any) => ({
        id: `S${a.id}`, scope: "SYSTEM" as const, scopeLabel: "운영자",
        title: a.title, body: a.body, type: a.type,
        categoryName: null, categoryTone: null,
        pinned: false, createdAt: a.createdAt.toISOString(),
      })),
    ].sort((x, y) => {
      if (x.pinned !== y.pinned) return x.pinned ? -1 : 1; // 고정 우선
      return y.createdAt.localeCompare(x.createdAt);        // 최신순
    });

    return NextResponse.json({ success: true, announcements: items });
  } catch (e: any) {
    console.error("[worker/announcements GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
