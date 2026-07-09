// GET  /api/worker/notices — 미확인 알림 목록
// POST /api/worker/notices/read — 알림 읽음 처리
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);
    // P3: unreadCount는 최근 50개 창이 아니라 전체 미확인 수를 별도 count로 집계(50개 초과 시 배지 누락 방지).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [notices, unreadCount]: [any[], number] = await Promise.all([
      prisma.workerNotice.findMany({
        where: { workerId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, title: true, body: true, type: true, kind: true, yearMonth: true, link: true, readAt: true, createdAt: true },
      }),
      prisma.workerNotice.count({ where: { workerId, readAt: null } }),
    ]);

    return NextResponse.json({
      success: true,
      notices: notices.map((n: any) => ({
        id:        n.id.toString(),
        title:     n.title,
        body:      n.body,
        type:      n.type,
        kind:      n.kind ?? "NOTICE_INDIVIDUAL",
        yearMonth: n.yearMonth,
        link:      n.link ?? null,
        read:      n.readAt !== null,
        readAt:    n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (e: any) {
    console.error("[worker/notices GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
