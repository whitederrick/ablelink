// 시스템 운영자: 전체 에이전시 결제/구독 현황
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    const agencies = await prisma.agency.findMany({
      select: {
        id: true, name: true, planType: true, isActive: true,
        maxCoaches: true, maxSites: true,
        trialEndsAt: true, nextBillingAt: true, subscribedAt: true, tossBillingKey: true,
        _count: { select: { managerAccounts: true, sites: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();

    return NextResponse.json({
      success: true,
      billing: agencies.map(a => {
        const trialEndsAt   = a.trialEndsAt   ? new Date(a.trialEndsAt)   : null;
        const nextBillingAt = a.nextBillingAt ? new Date(a.nextBillingAt) : null;
        const subscribedAt  = a.subscribedAt  ? new Date(a.subscribedAt)  : null;
        const isTrialExpired = trialEndsAt && trialEndsAt < now;
        const isBillingOverdue = nextBillingAt && nextBillingAt < now && a.planType !== "FREE" && a.planType !== "TRIAL";

        return {
          id:              a.id.toString(),
          name:            a.name,
          planType:        a.planType,
          isActive:        a.isActive,
          subscribedAt:    subscribedAt?.toISOString() ?? null,
          nextBillingAt:   nextBillingAt?.toISOString() ?? null,
          trialEndsAt:     trialEndsAt?.toISOString() ?? null,
          isTrialExpired,
          isBillingOverdue,
          hasBillingKey:   !!a.tossBillingKey,
          managerCount:    a._count.managerAccounts,
          siteCount:       a._count.sites,
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
