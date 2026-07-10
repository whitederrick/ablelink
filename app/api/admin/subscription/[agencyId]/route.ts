// app/api/admin/subscription/[agencyId]/route.ts
// 위탁기관 플랜 변경 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { requireManagerSession } from "@/lib/managerScope";
import { getConfigNumber } from "@/lib/systemConfig";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ agencyId: string }> }
) {
  try {
    const scope = await requireManagerSession(request);

    const { planType } = await request.json();
    const { agencyId: agencyIdStr } = await params;

    // A(P1): 매니저 자기스코프 라우트에서 유료 티어 승격 금지 — 유료 전환은 반드시 결제 경로
    //  (/api/payments/billing, Toss 실결제 후에만 planType 상향)로만. 이 라우트는 무료 전환(FREE 다운그레이드·
    //  TRIAL 시작)만 허용한다. (STARTER/STANDARD/PRO를 여기서 허용하면 매니저가 무결제로 자기 기관을 승격 가능)
    const VALID_PLAN_TYPES = ["FREE", "TRIAL"];
    if (!planType || !VALID_PLAN_TYPES.includes(planType)) {
      return NextResponse.json(
        { success: false, message: "유료 플랜 변경은 결제(구독)를 통해서만 가능합니다." },
        { status: 400 },
      );
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
      const trialDays = await getConfigNumber("TRIAL_DAYS");
      updateData.trialStartedAt = now;
      updateData.trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
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
