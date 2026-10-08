// lib/payments/billingLock.ts
// 기관 단위 결제 상태 변경(구독·플랜변경·해지) 직렬화 락.
//
// 배경(2026-10-08 감사 P2): 구독/플랜변경 라우트는 기관 행을 한 번 읽고 토스 호출(빌링키 발급·선환불·결제)을
//  거쳐 무조건 갱신한다. 탭 두 개에서 STANDARD·PRO를 동시에 고르면 orderId(e{epoch}_{PLAN})가 달라 둘 다
//  실결제되고, 먼저 낸 결제는 환불 경로 없이 남았다. 해지와 구독이 겹쳐도 마찬가지다.
//  → 같은 기관의 결제 상태 변경은 한 번에 하나만 허용한다(후발은 409).
//
// 구현: lib/rateLimit의 원자 INCR 클레임을 재사용(max=1). 비정상 종료(타임아웃 등)로 해제가 안 돼도
//  TTL(LOCK_TTL_SEC)로 자동 만료된다. Redis 장애 시 인메모리 폴백이라 단독으론 완전하지 않으므로,
//  구독 라우트는 활성화 시점에 billingEpoch 비교-교환(CAS) + 자동 환불을 2차 방어선으로 둔다.

import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";

// 라우트의 외부 호출(빌링키 발급·환불·결제 각 수초~20초) 합을 넉넉히 덮는 상한.
const LOCK_TTL_SEC = 120;

const lockKey = (agencyId: bigint | string) => `billing-lock:${agencyId}`;

/** 락 획득. false면 같은 기관의 다른 결제 변경이 진행 중. */
export async function acquireBillingLock(agencyId: bigint | string): Promise<boolean> {
  const r = await checkRateLimit(lockKey(agencyId), { max: 1, windowSec: LOCK_TTL_SEC, blockSec: 1 });
  return r.allowed;
}

/** 락 해제(획득한 요청만 호출). 실패해도 TTL로 만료되므로 예외를 삼킨다. */
export async function releaseBillingLock(agencyId: bigint | string): Promise<void> {
  try {
    await resetRateLimit(lockKey(agencyId));
  } catch (e) {
    console.warn("[billingLock] 해제 실패(TTL 만료 대기):", e);
  }
}

export const BILLING_BUSY_MESSAGE = "다른 구독 변경 또는 해지가 처리 중입니다. 잠시 후 다시 시도해 주세요.";
