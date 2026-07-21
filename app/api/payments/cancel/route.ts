// app/api/payments/cancel/route.ts
// 구독 해지 API — 해지 즉시 FREE 전환 + 잔여일 일할 부분환불(토스 부분취소, 공제 없음).
// 토스 입점 기준: 구독 해지 시 잔여일 청약철회(부분 환불) 보장. 산식 = lib/payments/refund.ts.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { PLAN_LIMITS } from "@/lib/planGuard";
import { computeProRataRefund } from "@/lib/payments/refund";
import { outboundAllowed } from "@/lib/outboundGuard";

const TOSS_SECRET_KEY = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
const TOSS_API = "https://api.tosspayments.com/v1";

function tossAuth() {
  return "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
}

export async function POST(request: NextRequest) {
  try {
    // 구독 해지는 본인 위탁기관 매니저만. (이전: 워커 세션 + 스코프 미검증 → 임의 위탁기관 해지 가능 버그)
    const scope = await requireManagerSession(request);
    const now = new Date();

    // 현재 주기를 커버하는 가장 최근 미환불 결제 건 — 잔여일 부분환불 대상.
    //  (플랜 변경 이력이 있으면 최신 결제 1건만 환불. 과거 결제분은 이미 종료 주기이거나 변경 시 대체됨.)
    const payment = await prisma.subscriptionPayment.findFirst({
      where: { agencyId: scope.agencyId, refundedAt: null, periodEnd: { gt: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    let refundAmount = 0;
    let remainingDays = 0;
    let refundSkippedDev = false;

    if (payment) {
      const pro = computeProRataRefund({
        amount: payment.amount,
        periodStart: payment.periodStart,
        periodEnd: payment.periodEnd,
        at: now,
      });
      refundAmount = pro.refundAmount;
      remainingDays = pro.remainingDays;
    }

    if (refundAmount > 0) {
      if (!outboundAllowed()) {
        // dev 안전모드: 실제 토스 부분취소가 나가지 않도록 차단(해지 자체는 진행, 환불 기록 안 함)
        refundSkippedDev = true;
        refundAmount = 0;
        console.log("[payments/cancel] dev 안전모드 — 토스 부분취소 건너뜀");
      } else {
        // paymentKey가 없으면(ALREADY_PROCESSED 복구로 기록된 건) orderId로 토스에서 조회 폴백.
        let paymentKey = payment!.paymentKey;
        if (!paymentKey) {
          const lookupRes = await fetch(`${TOSS_API}/payments/orders/${encodeURIComponent(payment!.orderId)}`, {
            headers: { Authorization: tossAuth() },
            signal: AbortSignal.timeout(10000),
          });
          const lookup = await lookupRes.json().catch(() => ({}));
          if (lookupRes.ok && lookup?.paymentKey) paymentKey = lookup.paymentKey as string;
        }
        if (!paymentKey) {
          // 결제 건 특정 실패 — 구독을 살려둔 채 실패 반환(재시도 가능). 자동환불 없는 해지 강행은 금지(입점 기준 위반).
          console.error("[payments/cancel] paymentKey 특정 실패:", payment!.orderId);
          return NextResponse.json(
            { success: false, message: "환불 대상 결제 건을 확인하지 못했습니다. 잠시 후 다시 시도하거나 고객센터로 문의해 주세요." },
            { status: 502 },
          );
        }

        // 부분취소 — Idempotency-Key(orderId 기준)로 재시도 시 이중환불 방지(토스가 동일 응답 재생).
        const cancelRes = await fetch(`${TOSS_API}/payments/${encodeURIComponent(paymentKey)}/cancel`, {
          method: "POST",
          headers: {
            Authorization: tossAuth(),
            "Content-Type": "application/json",
            "Idempotency-Key": `refund_${payment!.orderId}`,
          },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            cancelReason: "구독 중도 해지 — 잔여일 일할 환불",
            cancelAmount: refundAmount,
          }),
        });
        const cancelData = await cancelRes.json().catch(() => ({}));
        if (!cancelRes.ok) {
          // 환불 실패 시 해지도 하지 않는다(구독 유지) — 사용자가 재시도하면 멱등키로 안전.
          console.error("[payments/cancel] 부분취소 실패:", cancelData);
          return NextResponse.json(
            { success: false, message: cancelData?.message || "환불 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." },
            { status: 502 },
          );
        }
      }
    }

    const free = PLAN_LIMITS.FREE;
    // 환불 기록 + 구독 해지(빌링키 제거·FREE 전환·FREE 한도 복원)를 한 트랜잭션으로.
    //  토스 취소 성공 후 여기서 실패해도 재시도는 멱등키로 이중환불 없이 복구된다.
    await prisma.$transaction([
      ...(refundAmount > 0
        ? [prisma.subscriptionPayment.update({
            where: { id: payment!.id },
            data: { refundedAmount: refundAmount, refundedAt: now },
          })]
        : []),
      prisma.agency.update({
        where: { id: scope.agencyId },
        data: {
          planType: "FREE",
          tossBillingKey: null,
          tossCustomerKey: null,
          nextBillingAt: null,
          subscriptionId: null,
          subscriptionCanceledAt: now,
          // ★10차#2: 협상가(customAmount)는 1회성 딜 → 해지 시 소멸시킨다. 남겨두면 재구독 때 운영자 저장등급이
          //  FREE인 상태와 결합해 '협상가 청구 + FREE 부여'가 된다. 재협상 시 운영자가 다시 설정.
          customAmount: null,
          // ★20차 형제갭: 딜 소멸 시 주기도 표준(MONTHLY)으로 복원(admin PATCH 강등과 정합). ANNUAL 잔존 시
          //  운영자가 딜 재설정 폼에서 잔존 ANNUAL 기본값을 못 보고 월 협상가만 입력하면 연 1회 청구(언더차지) 소지.
          billingCycle: "MONTHLY",
          // 재구독이 새 orderId로 실결제되도록 이벤트 키를 올린다(같은 달 취소→재구독 무료사이클 방지).
          billingEpoch: { increment: 1 },
          maxWorkers: free.maxWorkers,
          maxSites: free.maxSites,
        },
      }),
    ]);

    const message =
      refundAmount > 0
        ? `구독이 해지되었습니다. 잔여 ${remainingDays}일에 대한 ${refundAmount.toLocaleString("ko-KR")}원이 결제 수단으로 부분 환불됩니다.`
        : refundSkippedDev
          ? "[dev 안전모드] 구독이 해지되었습니다. (실제 환불 호출은 차단됨)"
          : "구독이 해지되었습니다.";

    return NextResponse.json({ success: true, message, refundAmount, remainingDays });
  } catch (error: any) {
    if (error instanceof Response) return error;
    console.error("[payments/cancel]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
