// POST /api/admin/notices — 직무지도원에게 반려/안내 알림 발송
// GET  /api/admin/notices — 발송 이력 조회
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Number(searchParams.get("limit") ?? 50));

    const notices = await (prisma as any).workerNotice.findMany({
      where: { agencyId },
      include: { user: { select: { id: true, userName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      notices: notices.map((n: any) => ({
        id:         n.id.toString(),
        userId:     n.userId.toString(),
        userName:   n.user?.userName ?? "",
        title:      n.title,
        body:       n.body,
        type:       n.type,
        yearMonth:  n.yearMonth,
        read:       n.read,
        createdAt:  n.createdAt?.toISOString() ?? "",
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const body = await req.json().catch(() => ({}));
    const { userIds, title, body: msgBody, type = "INFO", yearMonth } = body;

    if (!title || !msgBody)
      return NextResponse.json({ success: false, message: "title, body 필수" }, { status: 400 });

    // userIds가 없으면 소속 전체 직무지도원에게 발송
    let targetIds: bigint[] = [];
    if (Array.isArray(userIds) && userIds.length > 0) {
      targetIds = userIds.map((id: string) => BigInt(id));
    } else {
      const assignments = await prisma.siteAssignment.findMany({
        where: { agencyId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
        select: { userId: true },
      });
      const unique = new Map<string, bigint>();
      for (const a of assignments) unique.set(a.userId.toString(), a.userId);
      targetIds = [...unique.values()];
    }

    if (targetIds.length === 0)
      return NextResponse.json({ success: false, message: "대상 직무지도원이 없습니다." }, { status: 404 });

    const noticeType = ["INFO", "WARN", "REJECT"].includes(type) ? type : "INFO";
    const created = await Promise.all(
      targetIds.map(uid =>
        (prisma as any).workerNotice.create({
          data: {
            userId: uid, agencyId,
            title: String(title).slice(0, 100),
            body:  String(msgBody).slice(0, 500),
            type:  noticeType,
            yearMonth: yearMonth || null,
          },
        })
      )
    );

    return NextResponse.json({ success: true, sent: created.length });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
