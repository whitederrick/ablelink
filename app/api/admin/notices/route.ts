// POST /api/admin/notices — 직무지도원에게 반려/안내 알림 발송
// GET  /api/admin/notices — 발송 이력 조회
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { parseBigInt } from "@/lib/adminScope";
import { checkRateLimit } from "@/lib/rateLimit";

export async function GET(req: NextRequest) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(req.url);
    const limit = Math.min(100, Number(searchParams.get("limit") ?? 50));

    const notices = await (prisma as any).workerNotice.findMany({
      where: { agencyId },
      include: { user: { select: { id: true, workerName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      notices: notices.map((n: any) => ({
        id:         n.id.toString(),
        workerId:     n.workerId.toString(),
        workerName:   n.user?.workerName ?? "",
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

    // 레이트리밋(알림 폭주 방지)
    const rl = await checkRateLimit(`notice-send:${scope.managerId}`);
    if (!rl.allowed) return NextResponse.json({ success: false, message: "요청이 많습니다. 잠시 후 다시 시도해주세요." }, { status: 429 });

    const body = await req.json().catch(() => ({}));
    // audience: "ALL"(전체) | "GROUP"(현장 단위) | "INDIVIDUAL"(개별)
    const { userIds, siteId, audience, title, body: msgBody, type = "INFO", yearMonth, link } = body;

    if (!title || !msgBody)
      return NextResponse.json({ success: false, message: "title, body 필수" }, { status: 400 });

    // 발송 범위 결정 — 명시적 audience 우선, 없으면 입력값으로 추론(하위호환).
    const mode: "ALL" | "GROUP" | "INDIVIDUAL" =
      audience === "ALL" || audience === "GROUP" || audience === "INDIVIDUAL"
        ? audience
        : Array.isArray(userIds) && userIds.length > 0 ? "INDIVIDUAL"
        : siteId ? "GROUP"
        : "ALL";

    const activeStatuses = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;
    let targetIds: bigint[] = [];
    let kind: "NOTICE_ALL" | "NOTICE_GROUP" | "NOTICE_INDIVIDUAL" = "NOTICE_ALL";

    if (mode === "INDIVIDUAL") {
      kind = "NOTICE_INDIVIDUAL";
      const requested = (Array.isArray(userIds) ? userIds : [])
        .map((id: unknown) => parseBigInt(id)).filter((id): id is bigint => id !== null);
      // ✅ 크로스테넌트 방지: 요청된 워커 중 "내 에이전시 소속"만 대상으로.
      if (requested.length > 0) {
        const valid = await prisma.siteAssignment.findMany({
          where: { agencyId, workerId: { in: requested }, status: { in: [...activeStatuses] } },
          select: { workerId: true },
        });
        targetIds = [...new Map(valid.map(a => [a.workerId.toString(), a.workerId])).values()];
      }
    } else if (mode === "GROUP") {
      kind = "NOTICE_GROUP";
      const sid = parseBigInt(siteId);
      if (!sid) return NextResponse.json({ success: false, message: "siteId가 필요합니다." }, { status: 400 });
      const assignments = await prisma.siteAssignment.findMany({
        where: { agencyId, siteId: sid, status: { in: [...activeStatuses] } },
        select: { workerId: true },
      });
      targetIds = [...new Map(assignments.map(a => [a.workerId.toString(), a.workerId])).values()];
    } else {
      kind = "NOTICE_ALL";
      const assignments = await prisma.siteAssignment.findMany({
        where: { agencyId, status: { in: [...activeStatuses] } },
        select: { workerId: true },
      });
      targetIds = [...new Map(assignments.map(a => [a.workerId.toString(), a.workerId])).values()];
    }

    if (targetIds.length === 0)
      return NextResponse.json({ success: false, message: "대상 직무지도원이 없습니다." }, { status: 404 });

    const noticeType = ["INFO", "WARN", "REJECT"].includes(type) ? type : "INFO";
    const result = await (prisma as any).workerNotice.createMany({
      data: targetIds.map(uid => ({
        workerId: uid, agencyId,
        title: String(title).slice(0, 100),
        body:  String(msgBody).slice(0, 1000),
        type:  noticeType,
        kind,
        yearMonth: yearMonth || null,
        link: typeof link === "string" && link ? link.slice(0, 300) : null,
      })),
    });

    return NextResponse.json({ success: true, sent: result.count });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
