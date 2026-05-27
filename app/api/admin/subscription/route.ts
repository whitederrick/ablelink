// app/api/admin/subscription/route.ts
// 에이전시 구독 현황 조회

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);

    const agencies = await prisma.agency.findMany({
      where: scope.role === "AGENCY" && scope.agencyId
        ? { id: scope.agencyId }
        : undefined,
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
      maxCoaches: a.maxCoaches,
      maxSites: a.maxSites,
      currentCoaches: a.assignments.length,
      currentSites: a.sites.length,
    }));

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/subscription]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
