// POST /api/admin/notices — 직무지도원에게 반려/안내 알림 발송
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";

export async function POST(req: NextRequest) {
  try {
    const scope    = await requireAdminSession(req);
    const agencyId = requireAgencyScope(scope);

    const body = await req.json().catch(() => ({}));
    const { userId, title, body: msgBody, type = "REJECT", yearMonth } = body;

    if (!userId || !title || !msgBody)
      return NextResponse.json({ success: false, message: "userId, title, body 필수" }, { status: 400 });

    const uidStr = String(userId);
    if (!/^\d+$/.test(uidStr))
      return NextResponse.json({ success: false, message: "잘못된 userId" }, { status: 400 });

    // 해당 유저가 이 에이전시 소속인지 검증
    const assignment = await prisma.siteAssignment.findFirst({
      where: { userId: BigInt(uidStr), agencyId, status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
    });
    if (!assignment)
      return NextResponse.json({ success: false, message: "해당 직무지도원을 찾을 수 없습니다." }, { status: 404 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notice = await (prisma as any).workerNotice.create({
      data: {
        userId:    BigInt(uidStr),
        agencyId,
        title:     String(title).slice(0, 100),
        body:      String(msgBody).slice(0, 500),
        type:      ["INFO", "WARN", "REJECT"].includes(type) ? type : "REJECT",
        yearMonth: yearMonth || null,
      },
    });

    return NextResponse.json({ success: true, id: notice.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/notices POST]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
