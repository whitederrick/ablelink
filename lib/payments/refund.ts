// lib/payments/refund.ts
// 구독 중도 해지 잔여일 일할 환불 산식(공제 없음) — 토스 입점 기준(구독 해지 시 잔여일 청약철회 보장).
// 환불액 = 결제금액 × 잔여일 ÷ 결제주기 총일수. 해지 당일은 이용일로 계산(잔여일에서 제외).

const MS_DAY = 24 * 60 * 60 * 1000;

// 환불정책 제3조: 결제 7일 이내 + 유료기능 미이용이면 청약철회(전액 환불).
export const FULL_REFUND_WINDOW_DAYS = 7;

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
