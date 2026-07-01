// app/api/admin/dashboard-promos/route.ts
// 위탁기관 대시보드용 소식 티커 + 광고(게시중) 조회. 전 기관 공통(운영자 관리).
// 티커 = 시스템 공지 중 '티커 노출' 선택된 것(중복 관리 방지, 공지 재활용).
// 광고 = DashboardPromo(AD) 게시중.
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { getConfigNumber } from "@/lib/systemConfig";

const TICKER_BADGE: Record<string, string> = { INFO: "소식", MAINTENANCE: "점검", URGENT: "긴급" };

export async function GET(req: Request) {
  try {
    await requireManagerSession(req);
    const now = new Date();

    const [tickerRows, adRows, tickerDurationSec] = await Promise.all([
      // 티커 = 티커노출 선택 공지(최신순). 시스템 공지는 모두 최소 관리자 대상이라 audience 추가필터 불필요.
      prisma.systemAnnouncement.findMany({
        where: { showInTicker: true },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, title: true, type: true },
      }),
      // 광고 = 게시중(활성 + 기간 내)
      prisma.dashboardPromo.findMany({
        where: {
          kind: "AD",
          isActive: true,
          AND: [
            { OR: [{ startAt: null }, { startAt: { lte: now } }] },
            { OR: [{ endAt: null }, { endAt: { gte: now } }] },
          ],
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { badge: true, title: true, body: true, imageUrl: true, href: true, layout: true, textColor: true },
      }),
      getConfigNumber("DASHBOARD_TICKER_DURATION_SEC"),
    ]);

    const ticker = tickerRows.map(a => ({ badge: TICKER_BADGE[a.type] ?? "소식", text: a.title, href: "/manager/system-notices" }));
    const ads = adRows.map(r => ({ badge: r.badge ?? undefined, title: r.title, description: r.body ?? undefined, imageUrl: r.imageUrl ?? undefined, href: r.href ?? undefined, layout: (r.layout as any) ?? "TEXT", textColor: (r.textColor as any) ?? "LIGHT", external: !!r.href && /^https?:\/\//.test(r.href) }));

    return NextResponse.json({ success: true, data: { ticker, ads, tickerDurationSec } });
  } catch (e: any) {
    if (e instanceof Response || (e && typeof e.status === "number")) return e as any;
    return NextResponse.json({ success: false, message: "조회 실패" }, { status: 500 });
  }
}
