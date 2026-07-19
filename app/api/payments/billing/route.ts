// app/api/payments/billing/route.ts
// 토스페이먼츠 빌링키 발급 + 최초 결제 API
// 흐름: 카드 등록 → 빌링키 발급 → 즉시 결제 → DB 업데이트

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { requireManagerSession } from "@/lib/managerScope";
import { PLAN_PRICES, PLAN_NAMES, effectiveBilling, advanceBilling, cycleLabel, buildSubscribeOrderId, resolveActivationPlan } from "@/lib/billing";
import { isPaidAgencyPlan } from "@/lib/plans";
import { outboundAllowed } from "@/lib/outboundGuard";

const TOSS_SECRET_KEY = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
const TOSS_API = "https://api.tosspayments.com/v1";

function tossAuth() {
  return "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    const scope = await requireManagerSession(request);

    // dev 안전모드: 로컬에서 실제 토스 빌링키 발급·결제가 나가지 않도록 차단
    if (!outboundAllowed()) {
      return NextResponse.json(
        { success: false, message: "[dev 안전모드] 실제 결제가 차단되었습니다. (운영에서만 실행 · OUTBOUND_LIVE=1로 강제 가능)" },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const { agencyId, planType, authKey, customerKey } = body;

    if (!agencyId || !/^\d+$/.test(String(agencyId)) || !planType || !authKey || !customerKey) {
      return NextResponse.json(
        { success: false, message: "필수 파라미터가 누락됐습니다." },
        { status: 400 }
      );
    }

    // 자기 위탁기관만 구독 변경 가능
    if (scope.agencyId !== BigInt(agencyId)) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    if (!PLAN_PRICES[planType]) {
      return NextResponse.json(
        { success: false, message: "유효하지 않은 플랜입니다." },
        { status: 400 }
      );
    }

    // 운영자 딜(주기·협상가) 반영을 위해 위탁기관 조회
    const agencyRow = await prisma.agency.findUnique({
      where: { id: BigInt(agencyId) },
      select: { planType: true, billingCycle: true, customAmount: true, billingEpoch: true },
    });
    if (!agencyRow) {
      return NextResponse.json({ success: false, message: "위탁기관를 찾을 수 없습니다." }, { status: 404 });
    }
    // #2(권한상승 차단): 운영자 협상가(customAmount)가 설정된 기관은 운영자가 합의한 등급(agencyRow.planType)으로
    //  고정한다. 협상가만 청구하면서 매니저가 body.planType으로 임의 상위등급(PRO 등)을 고르면 '협상가로 상위 한도·
    //  기능 사용'이라는 권한상승이 되므로. 표준가 결제(customAmount 없음)는 매니저가 고른 planType 그대로.
    //  → cron 자동결제(agencyRow.planType 사용)와 등급 결정 일원화.
    const effectivePlanType = resolveActivationPlan(planType, agencyRow.planType, agencyRow.customAmount);

    // ★10차#2 백스톱(단일 chokepoint): 결제로 활성화되는 등급은 반드시 유료여야 한다. 협상가(customAmount)가
    //  남아있는데 운영자 저장등급이 무료(FREE/TRIAL)로 강등된 상태(해지 잔여·설정 오류)면 effectivePlanType이
    //  FREE로 잡혀 '협상가 청구 + FREE 등급 부여 + cron 재청구 없음(자가회복 불가)'가 된다. 여기서 원천 차단.
    //  (정상 재구독은 해지 시 customAmount가 클리어돼 requestedPlan[유료]로 통과. cron은 유료기관만 청구.)
    if (!isPaidAgencyPlan(effectivePlanType)) {
      return NextResponse.json(
        { success: false, message: "협상가 설정이 구독 등급과 일치하지 않습니다. 운영자에게 문의해 주세요." },
        { status: 400 },
      );
    }

    // 청구 금액·주기 = 운영자 협상가 우선, 없으면 표준 월정액. (확정 등급 기준으로 표준가 산출)
    const { amount, cycle } = effectiveBilling({ planType: effectivePlanType, billingCycle: agencyRow.billingCycle, customAmount: agencyRow.customAmount });

    // 1. 빌링키 발급 (토스 빌링키 발급 엔드포인트는 /issue. 과거 /confirm은 404)
    const billingRes = await fetch(`${TOSS_API}/billing/authorizations/issue`, {
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
    const now = new Date();
    // 이벤트 키(billingEpoch×plan) orderId — 시간 미포함이라 재시도(자정/월경계 무관)는 같은 orderId로 멱등
    //  복구되고, 해지→재구독은 epoch가 올라 새 orderId로 실결제된다(이중청구·무료사이클 딜레마 근본 제거).
    const orderId = buildSubscribeOrderId(agencyId, agencyRow.billingEpoch, effectivePlanType);

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
        orderName: `${PLAN_NAMES[effectivePlanType]} ${cycleLabel(cycle)} 구독`,
        customerEmail: billingData.customerEmail || null,
        customerName: billingData.customerName || null,
        taxFreeAmount: 0,
      }),
    });

    const chargeData = await chargeRes.json();

    // 이미 이 orderId로 결제 완료(직전 성공 후 DB 실패 재시도) = 성공 간주, 아래 DB 보정으로 진행.
    const alreadyPaid = !chargeRes.ok && chargeData?.code === "ALREADY_PROCESSED_PAYMENT";
    if (!chargeRes.ok && !alreadyPaid) {
      console.error("[payments/billing] 결제 실패:", chargeData);
      return NextResponse.json(
        { success: false, message: chargeData.message || "결제에 실패했습니다." },
        { status: 400 }
      );
    }

    // 3. DB 업데이트 — 다음 결제일은 딜 주기(월/연)로 가산
    const nextBillingAt = advanceBilling(now, cycle);

    const limits = PLAN_LIMITS[effectivePlanType] || { maxWorkers: 0, maxSites: 0 };

    await prisma.agency.update({
      where: { id: BigInt(agencyId) },
      data: {
        planType: effectivePlanType,
        tossBillingKey: billingKey,
        tossCustomerKey: customerKey,
        subscriptionId: chargeData.orderId ?? orderId,
        subscribedAt: now,
        nextBillingAt,
        subscriptionCanceledAt: null,
        // trialStartedAt은 지우지 않는다 — '트라이얼 1회 소진' 이력을 영구 보존해 취소→재트라이얼 남용 방지.
        trialEndsAt: null,
        // ★성공한 활성화마다 이벤트 키 소비(+1) — 이후 어떤 재구독/plan 복귀도 새 orderId가 되어 무결제
        //  재사용(A→B→A 왕복·다른 강등경로 후 재구독)이 원천 차단된다. 이 증가는 활성화 update와 원자적이라
        //  결제 성공+DB실패 재시도 시엔 epoch가 소비되지 않아 같은 orderId로 멱등 복구된다(이중청구 없음).
        billingEpoch: { increment: 1 },
        maxWorkers: limits.maxWorkers,
        maxSites: limits.maxSites,
      },
    });

    console.log(`[payments/billing] 구독 완료: agencyId=${agencyId}, plan=${effectivePlanType}, amount=${amount}`);

    return NextResponse.json({
      success: true,
      planType: effectivePlanType,
      amount,
      nextBillingAt: nextBillingAt.toISOString(),
      paymentKey: chargeData.paymentKey ?? null,
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
