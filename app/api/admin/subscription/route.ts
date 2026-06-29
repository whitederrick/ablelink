// app/api/admin/subscription/route.ts
// 위탁기관 구독 현황 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    // 듀얼: 운영자=전체 기관, 매니저=본인 기관
    const session = await requireAdminOrManagerSession(req);
    const agencyId = session.kind === "manager" ? session.agencyId : undefined;

    const agencies = await prisma.agency.findMany({
      where: { ...(agencyId ? { id: agencyId } : {}) },
      include: {
        sites: { where: { isActive: true }, select: { id: true } },
        assignments: { where: { status: "ACTIVE" }, select: { id: true } },
      },
      orderBy: { id: "asc" },
    });

    const data = agencies.map(a => ({
      id: a.id.toString(),
      name: a.name,
      planType: a.planType,
      trialStartedAt: a.trialStartedAt?.toISOString() ?? null,
      trialEndsAt: a.trialEndsAt?.toISOString() ?? null,
      subscribedAt: a.subscribedAt?.toISOString() ?? null,
      nextBillingAt: a.nextBillingAt?.toISOString() ?? null,
      maxWorkers: a.maxWorkers,
      maxSites: a.maxSites,
      currentWorkers: a.assignments.length,
      currentSites: a.sites.length,
      billingCycle: a.billingCycle,
      customAmount: a.customAmount,
    }));

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/subscription]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
