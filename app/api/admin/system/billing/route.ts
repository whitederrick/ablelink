// 시스템 운영자: 전체 에이전시 결제/구독 현황
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const agencies = await prisma.agency.findMany({
      select: {
        id: true, name: true, planType: true,
        maxCoaches: true, maxSites: true,
        _count: { select: { adminUsers: true, sites: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();

    return NextResponse.json({
      success: true,
      billing: agencies.map(a => {
        const trialEndsAt   = (a as any).trialEndsAt   ? new Date((a as any).trialEndsAt)   : null;
        const nextBillingAt = (a as any).nextBillingAt  ? new Date((a as any).nextBillingAt) : null;
        const subscribedAt  = (a as any).subscribedAt   ? new Date((a as any).subscribedAt)  : null;
        const isTrialExpired = trialEndsAt && trialEndsAt < now;
        const isBillingOverdue = nextBillingAt && nextBillingAt < now && a.planType !== "FREE" && a.planType !== "TRIAL";

        return {
          id:              a.id.toString(),
          name:            a.name,
          planType:        a.planType,
          isActive:        (a as any).isActive ?? true,
          subscribedAt:    subscribedAt?.toISOString() ?? null,
          nextBillingAt:   nextBillingAt?.toISOString() ?? null,
          trialEndsAt:     trialEndsAt?.toISOString() ?? null,
          isTrialExpired,
          isBillingOverdue,
          hasBillingKey:   !!((a as any).tossBillingKey),
          managerCount:    a._count.adminUsers,
          siteCount:       a._count.sites,
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
