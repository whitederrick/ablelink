// app/api/admin/subscription/[agencyId]/route.ts
// 에이전시 플랜 변경 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/planGuard";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agencyId: string }> }
) {
  try {
    const { planType } = await request.json();
    const agencyId = BigInt(agencyId);

    const limits = PLAN_LIMITS[planType] || { maxCoaches: 0, maxSites: 0 };
    const now = new Date();

    const updateData: any = {
      planType,
      maxCoaches: limits.maxCoaches,
      maxSites: limits.maxSites,
    };

    // TRIAL 시작 처리
    if (planType === "TRIAL") {
      updateData.trialStartedAt = now;
      updateData.trialEndsAt = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    }

    // 유료 구독 전환
    if (["STARTER", "STANDARD", "PRO"].includes(planType)) {
      updateData.subscribedAt = updateData.subscribedAt || now;
    }

    await prisma.agency.update({
      where: { id: agencyId },
      data: updateData,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[admin/subscription/patch]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
