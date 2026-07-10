// app/api/payments/cancel/route.ts
// 구독 해지 API

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { PLAN_LIMITS } from "@/lib/planGuard";

export async function POST(request: NextRequest) {
  try {
    // 구독 해지는 본인 위탁기관 매니저만. (이전: 워커 세션 + 스코프 미검증 → 임의 위탁기관 해지 가능 버그)
    const scope = await requireManagerSession(request);

    const free = PLAN_LIMITS.FREE;
    // 구독 해지: 빌링키 제거, 다음 결제일 제거, FREE로 변경 + FREE 한도 복원
    await prisma.agency.update({
      where: { id: scope.agencyId },
      data: {
        planType: "FREE",
        tossBillingKey: null,
        tossCustomerKey: null,
        nextBillingAt: null,
        subscriptionId: null,
        subscriptionCanceledAt: new Date(),
        // 재구독이 새 orderId로 실결제되도록 이벤트 키를 올린다(같은 달 취소→재구독 무료사이클 방지).
        billingEpoch: { increment: 1 },
        maxWorkers: free.maxWorkers,
        maxSites: free.maxSites,
      },
    });

    return NextResponse.json({ success: true, message: "구독이 해지되었습니다." });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("[payments/cancel]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
