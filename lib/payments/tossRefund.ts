// lib/payments/tossRefund.ts
// SubscriptionPayment 1건에 대한 토스 부분취소 엔진 — claim(선점) 기반.
//
// 왜 claim인가(2026-07-21 감사 P1): 토스 Idempotency-Key는 15일 유효 + 같은 키에 다른 본문이면 멱등 재생이
// 보장되지 않는다. 환불액을 호출 시점마다 일할 재계산하면 재시도 본문이 달라져(날짜 경과) 멱등이 깨지고,
// 15일 뒤 재시도는 신규 취소로 처리돼 이중환불이 된다. 그래서:
//   ① claim: 환불액을 DB에 먼저 고정 기록(refundPendingAmount) — 재시도는 항상 같은 금액=같은 본문.
//   ② 사전확인: 토스 orders/{orderId} 조회로 기취소액을 확인 — 이미 claim 이상 취소돼 있으면(15일 경과 재시도·
//      콘솔 수동환불 포함) 호출 없이 완료 처리.
//   ③ 고정 금액 부분취소(Idempotency-Key) — ALREADY_CANCELED 등은 재조회로 완료 동치 판정.
//   ④ finalize: refundedAmount·refundedAt 기록, claim 해제. 실패 시 claim 유지(재시도 동일 금액).
//
// 전제: 호출자는 outboundAllowed()를 통과한 운영 경로여야 한다(엔진도 방어적으로 재확인).

import { prisma } from "@/lib/prisma";
import { outboundAllowed } from "@/lib/outboundGuard";
import { shouldReclaimStaleRefund } from "@/lib/payments/refund";

const TOSS_SECRET_KEY = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
const TOSS_API = "https://api.tosspayments.com/v1";

function tossAuth() {
  return "Basic " + Buffer.from(TOSS_SECRET_KEY + ":").toString("base64");
}

export type RefundOutcome =
  | { ok: true; refundedAmount: number; alreadyRefunded: boolean }
  | { ok: false; reason: string };

// 환불 발생 경로 — 사이클링 남용 모니터가 해지(CANCEL)만 집계하도록 구분(2026-07-21 감사 P3).
export type RefundKind = "CANCEL" | "PLAN_CHANGE" | "ADMIN_TERMINATION" | "CONFLICT";

export async function refundSubscriptionPayment(params: {
  paymentId: bigint;
  amount: number; // 이번 환불액(호출자가 산식으로 확정). 기존 claim이 있으면 그 금액이 우선한다.
  reason: string; // 토스 cancelReason
  kind: RefundKind; // 환불 경로 — DB refundKind로 기록(모니터링 판별용).
}): Promise<RefundOutcome> {
  const { paymentId, reason, kind } = params;
  if (!outboundAllowed()) return { ok: false, reason: "dev 안전모드 — 환불 호출 차단" };

  const payment = await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
  if (!payment) return { ok: false, reason: "결제 이력을 찾을 수 없습니다." };
  if (payment.refundedAt) return { ok: true, refundedAmount: payment.refundedAmount, alreadyRefunded: true };

  // ① claim — 최초 시도만 금액을 고정하고, 이후엔 고정된 금액을 재사용한다(동시 시도 포함).
  let fixedAmount = payment.refundPendingAmount;
  let claimAt: Date | null = payment.refundClaimedAt;
  if (fixedAmount == null) {
    const at = new Date();
    const claimed = await prisma.subscriptionPayment.updateMany({
      where: { id: paymentId, refundedAt: null, refundPendingAmount: null },
      data: { refundPendingAmount: params.amount, refundClaimedAt: at },
    });
    if (claimed.count === 1) {
      fixedAmount = params.amount;
      claimAt = at;
    } else {
      // 경합 — 다른 시도가 먼저 claim했거나 완료함. 현재 상태를 다시 읽어 따른다.
      const fresh = await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
      if (!fresh) return { ok: false, reason: "결제 이력을 찾을 수 없습니다." };
      if (fresh.refundedAt) return { ok: true, refundedAmount: fresh.refundedAmount, alreadyRefunded: true };
      fixedAmount = fresh.refundPendingAmount ?? params.amount;
      claimAt = fresh.refundClaimedAt;
    }
  }
  if (fixedAmount <= 0) {
    await finalize(paymentId, 0, kind);
    return { ok: true, refundedAmount: 0, alreadyRefunded: false };
  }

  // ② 사전확인 — paymentKey 확보 + 기취소액 검사. 조회 실패 시 이중환불 위험을 안고 진행하지 않는다(재시도 가능).
  let lookup: { paymentKey?: string; balanceAmount?: number } = {};
  try {
    const res = await fetch(`${TOSS_API}/payments/orders/${encodeURIComponent(payment.orderId)}`, {
      headers: { Authorization: tossAuth() },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, reason: "환불 대상 결제 조회에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    lookup = await res.json();
  } catch {
    return { ok: false, reason: "환불 대상 결제 조회에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }
  const paymentKey = payment.paymentKey ?? lookup.paymentKey;
  if (!paymentKey) return { ok: false, reason: "환불 대상 결제 건을 특정하지 못했습니다. 고객센터로 문의해 주세요." };

  const balance = typeof lookup.balanceAmount === "number" ? lookup.balanceAmount : payment.amount;
  const alreadyCanceled = payment.amount - balance;

  // ①-b stale claim 재산정(2026-07-21 P3): claim이 충분히 오래됐고(진행 중 취소 없음 보증) 실제 취소액이 0이면
  //  이전 시도가 취소를 성사시키지 못한 채 과거 금액만 고정된 상태 → 호출자의 현재 공정 금액으로 재고정.
  //  판별=shouldReclaimStaleRefund(순수·테스트됨). 재고정은 claimClaimedAt 낙관적 락으로 단일 승자만 수행하고,
  //  멱등키가 claim 시각을 포함해 회전한다(아래 ③). alreadyCanceled==0 + TTL 경과로 성사/진행 중 취소가 없음이
  //  증명돼 이중환불 불가. (즉시 재시도는 TTL 이내라 얼려서 토스 멱등 재생으로 처리.)
  const claimAgeMs = claimAt ? Date.now() - claimAt.getTime() : Infinity;
  if (shouldReclaimStaleRefund({ claimAgeMs, alreadyCanceled, freshAmount: params.amount, claimedAmount: fixedAmount })) {
    const at = new Date();
    const reclaimed = await prisma.subscriptionPayment.updateMany({
      where: { id: paymentId, refundedAt: null, refundClaimedAt: claimAt },
      data: { refundPendingAmount: params.amount, refundClaimedAt: at },
    });
    if (reclaimed.count === 1) {
      fixedAmount = params.amount;
      claimAt = at;
    } else {
      // 경합 — 다른 시도가 재고정/완료. 현재 상태를 다시 읽어 따른다(같은 새 claim 시각·금액으로 수렴).
      const fresh = await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
      if (!fresh) return { ok: false, reason: "결제 이력을 찾을 수 없습니다." };
      if (fresh.refundedAt) return { ok: true, refundedAmount: fresh.refundedAmount, alreadyRefunded: true };
      fixedAmount = fresh.refundPendingAmount ?? params.amount;
      claimAt = fresh.refundClaimedAt;
    }
  }

  if (alreadyCanceled >= fixedAmount) {
    // 이미 이번 환불분 이상이 취소돼 있음(15일 경과 재시도·토스 콘솔 수동환불) → 완료 동치.
    await finalize(paymentId, fixedAmount, kind);
    return { ok: true, refundedAmount: fixedAmount, alreadyRefunded: true };
  }
  // 외부 개입으로 취소가능 잔액이 모자라면 남은 만큼만(콘솔 수동 부분환불과의 공존 — 정상 흐름에선 발생하지 않음).
  const cancelAmount = Math.min(fixedAmount, balance);
  if (cancelAmount <= 0) {
    await finalize(paymentId, Math.max(0, alreadyCanceled), kind);
    return { ok: true, refundedAmount: Math.max(0, alreadyCanceled), alreadyRefunded: true };
  }

  // ③ 부분취소 — 고정 금액·고정 멱등키(본문 불변이라 15일 내 재시도는 저장 응답 재생). 키에 claim 시각을 포함해
  //  재산정(①-b) 시 회전 — 재산정은 alreadyCanceled==0으로 이전 키의 취소가 성사되지 않았음이 증명된 뒤에만 일어나
  //  이전 키의 취소와 겹치지 않는다.
  let cancelData: { code?: string; message?: string } = {};
  try {
    const res = await fetch(`${TOSS_API}/payments/${encodeURIComponent(paymentKey)}/cancel`, {
      method: "POST",
      headers: {
        Authorization: tossAuth(),
        "Content-Type": "application/json",
        "Idempotency-Key": `refund_${payment.orderId}_${claimAt ? claimAt.getTime() : 0}`,
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ cancelReason: reason, cancelAmount }),
    });
    cancelData = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (cancelData?.code === "ALREADY_CANCELED_PAYMENT") {
        // 전액 취소 완료 상태 — 이번 몫 이상이 이미 환불됨. 완료 동치.
        await finalize(paymentId, fixedAmount, kind);
        return { ok: true, refundedAmount: fixedAmount, alreadyRefunded: true };
      }
      console.error("[tossRefund] 부분취소 실패:", payment.orderId, cancelData?.code, cancelData?.message);
      return { ok: false, reason: cancelData?.message || "환불 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." };
    }
  } catch {
    return { ok: false, reason: "환불 처리에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

  // ④ finalize — DB 실패해도 claim·멱등키·사전확인 조합으로 재시도가 안전(이중환불 없음).
  await finalize(paymentId, cancelAmount, kind);
  return { ok: true, refundedAmount: cancelAmount, alreadyRefunded: false };
}

async function finalize(paymentId: bigint, refundedAmount: number, kind: RefundKind): Promise<void> {
  await prisma.subscriptionPayment.update({
    where: { id: paymentId },
    data: { refundedAmount, refundedAt: new Date(), refundPendingAmount: null, refundKind: kind },
  });
}
