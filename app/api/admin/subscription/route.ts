// app/api/admin/subscription/route.ts
// 에이전시 구독 현황 조회

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const agencies = await prisma.agency.findMany({
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
  } catch (error: any) {
    console.error("[admin/subscription]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
