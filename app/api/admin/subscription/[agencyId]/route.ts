// app/api/admin/subscription/[agencyId]/route.ts
// 에이전시 플랜 변경 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { requireManagerSession } from "@/lib/managerScope";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agencyId: string }> }
) {
  try {
    const scope = await requireManagerSession(request);

    const { planType } = await request.json();
    const { agencyId: agencyIdStr } = await params;

    const VALID_PLAN_TYPES = ["FREE", "TRIAL", "STARTER", "STANDARD", "PRO"];
    if (!planType || !VALID_PLAN_TYPES.includes(planType)) {
      return NextResponse.json({ success: false, message: "유효하지 않은 planType입니다." }, { status: 400 });
    }

    const agencyId = BigInt(agencyIdStr);

    if (scope.agencyId !== agencyId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    const limits = PLAN_LIMITS[planType] || { maxWorkers: 0, maxSites: 0 };
    const now = new Date();

    const updateData: any = {
      planType,
      maxWorkers: limits.maxWorkers,
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
