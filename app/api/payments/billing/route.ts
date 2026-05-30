// app/api/payments/billing/route.ts
// 토스페이먼츠 빌링키 발급 + 최초 결제 API
// 흐름: 카드 등록 → 빌링키 발급 → 즉시 결제 → DB 업데이트

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { requireManagerSession } from "@/lib/managerScope";

const TOSS_SECRET_KEY = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
const TOSS_API = "https://api.tosspayments.com/v1";

// 플랜별 가격 (월정액, 원)
const PLAN_PRICES: Record<string, number> = {
  STARTER:  30000,  // 3만원/월
  STANDARD: 80000,  // 8만원/월
  PRO:      150000, // 15만원/월
};

const PLAN_NAMES: Record<string, string> = {
  STARTER:  "AbleLink 스타터",
  STANDARD: "AbleLink 스탠다드",
  PRO:      "AbleLink 프로",
};

function tossAuth() {
  return "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);

    const body = await request.json();
    const { agencyId, planType, authKey, customerKey } = body;

    if (!agencyId || !planType || !authKey || !customerKey) {
      return NextResponse.json(
        { success: false, message: "필수 파라미터가 누락됐습니다." },
        { status: 400 }
      );
    }

    // 자기 에이전시만 구독 변경 가능
    if (scope.agencyId !== BigInt(agencyId)) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    if (!PLAN_PRICES[planType]) {
      return NextResponse.json(
        { success: false, message: "유효하지 않은 플랜입니다." },
        { status: 400 }
      );
    }

    // 1. 빌링키 발급
    const billingRes = await fetch(`${TOSS_API}/billing/authorizations/confirm`, {
      method: "POST",
      headers: {
        Authorization: tossAuth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ authKey, customerKey }),
    });

    const billingData = await billingRes.json();

    if (!billingRes.ok) {
      console.error("[payments/billing] 빌링키 발급 실패:", billingData);
      return NextResponse.json(
        { success: false, message: billingData.message || "카드 등록에 실패했습니다." },
        { status: 400 }
      );
    }

    const billingKey = billingData.billingKey;
    const amount = PLAN_PRICES[planType];
    const orderId = `ablelink_${agencyId}_${Date.now()}`;
    const now = new Date();

    // 2. 최초 결제
    const chargeRes = await fetch(`${TOSS_API}/billing/${billingKey}`, {
      method: "POST",
      headers: {
        Authorization: tossAuth(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        customerKey,
        amount,
        orderId,
        orderName: `${PLAN_NAMES[planType]} 월 구독`,
        customerEmail: billingData.customerEmail || null,
        customerName: billingData.customerName || null,
        taxFreeAmount: 0,
      }),
    });

    const chargeData = await chargeRes.json();

    if (!chargeRes.ok) {
      console.error("[payments/billing] 결제 실패:", chargeData);
      return NextResponse.json(
        { success: false, message: chargeData.message || "결제에 실패했습니다." },
        { status: 400 }
      );
    }

    // 3. DB 업데이트
    const nextBillingAt = new Date(now);
    nextBillingAt.setMonth(nextBillingAt.getMonth() + 1);

    const limits = PLAN_LIMITS[planType] || { maxWorkers: 0, maxSites: 0 };

    await prisma.agency.update({
      where: { id: BigInt(agencyId) },
      data: {
        planType,
        tossBillingKey: billingKey,
        tossCustomerKey: customerKey,
        subscriptionId: chargeData.orderId,
        subscribedAt: now,
        nextBillingAt,
        trialStartedAt: null,
        trialEndsAt: null,
        maxWorkers: limits.maxWorkers,
        maxSites: limits.maxSites,
      },
    });

    console.log(`[payments/billing] 구독 완료: agencyId=${agencyId}, plan=${planType}, amount=${amount}`);

    return NextResponse.json({
      success: true,
      planType,
      amount,
      nextBillingAt: nextBillingAt.toISOString(),
      paymentKey: chargeData.paymentKey,
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[payments/billing]", e);
    return NextResponse.json(
      { success: false, message: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
