// lib/payments/refund.ts
// 구독 중도 해지 잔여일 일할 환불 산식(공제 없음) — 토스 입점 기준(구독 해지 시 잔여일 청약철회 보장).
// 환불액 = 결제금액 × 잔여일 ÷ 결제주기 총일수. 해지 당일은 이용일로 계산(잔여일에서 제외).

const MS_DAY = 24 * 60 * 60 * 1000;

// 환불정책 제3조: 결제 7일 이내 + 유료기능 미이용이면 청약철회(전액 환불).
export const FULL_REFUND_WINDOW_DAYS = 7;

// ── claim(선점) 재산정 정책 (2026-07-21 P3: stale claim 과다환불) ─────────────────────────
// claim은 환불액을 DB에 고정해 재시도의 멱등키 본문을 불변으로 만든다. 그런데 첫 시도가 토스 취소를
// 성사시키지 못한 채 claim만 남으면(조회 실패 등), 그 고정 금액이 며칠 뒤 재시도까지 유지돼 잔여일이
// 크게 줄었는데도 과거의 큰 금액이 환불되는 과다환불이 생긴다.
//
// 안전한 재산정 조건: claim이 '진행 중 토스 취소가 없음'이 보증될 만큼 충분히 오래됐고(CLAIM_FRESH_MS 경과),
// 토스 조회상 실제 취소액이 0이면(= 이전 시도가 취소를 성사시키지 못함) → 호출자의 현재 공정 금액으로 재고정.
// 재고정 시 멱등키가 claim 시각을 포함해 회전하지만, 위 두 조건이 '성사/진행 중 취소 없음'을 증명해 이중환불이
// 원천 불가하다. (claim 수명 << CLAIM_FRESH_MS인 즉시 재시도는 얼려서 토스 멱등 재생으로 안전 처리.)
//
// 값=1시간: 토스 호출 타임아웃(10초)의 360배라 진행 중 취소가 남아 있을 수 없고, 1시간 드리프트는 월정액
// 기준 ~137원으로 무시할 수준이라 즉시 재시도를 얼려도 손해가 없다. 정작 큰 과다환불(며칠 뒤 재시도)만 재산정.
export const CLAIM_FRESH_MS = 60 * 60 * 1000;

export function shouldReclaimStaleRefund(params: {
  claimAgeMs: number;      // 현재 claim이 기록된 뒤 경과 시간(ms). claim 시각 없으면 Infinity로 전달.
  alreadyCanceled: number; // 토스 조회상 이미 취소된 금액(원). >0이면 이전 취소가 성사됨 → 재산정 금지.
  freshAmount: number;     // 호출자가 지금 재계산한 공정 환불액.
  claimedAmount: number;   // 현재 고정돼 있는 claim 금액.
}): boolean {
  return params.claimAgeMs > CLAIM_FRESH_MS
    && params.alreadyCanceled <= 0
    && params.freshAmount > 0
    && params.freshAmount !== params.claimedAmount;
}

export function isWithinFullRefundWindow(periodStart: Date, at: Date): boolean {
  const elapsed = at.getTime() - periodStart.getTime();
  return elapsed >= 0 && elapsed <= FULL_REFUND_WINDOW_DAYS * MS_DAY;
}

export interface ProRataRefund {
  totalDays: number;
  usedDays: number;
  remainingDays: number;
  refundAmount: number;
}

export function computeProRataRefund(params: {
  amount: number; // 결제 금액(원)
  periodStart: Date; // 결제주기 시작(결제 시각)
  periodEnd: Date; // 결제주기 종료(다음 결제일)
  at: Date; // 해지 시각
}): ProRataRefund {
  const { amount, periodStart, periodEnd, at } = params;
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  const totalDays = Math.max(1, Math.round(totalMs / MS_DAY));

  // 주기 밖 해지: 종료 후=환불 0, 시작 전(비정상)=전액.
  const elapsedMs = at.getTime() - periodStart.getTime();
  // 해지 당일 이용분은 이용일 1일로 계산(부분일 올림).
  const usedDays = Math.min(totalDays, Math.max(0, Math.ceil(elapsedMs / MS_DAY)));
  const remainingDays = totalDays - usedDays;

  const refundAmount = Math.max(0, Math.floor((amount * remainingDays) / totalDays));
  return { totalDays, usedDays, remainingDays, refundAmount };
}
