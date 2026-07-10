// lib/billing.ts
// 결제 금액·주기 계산. 할인 정책은 코드에 박지 않고, 운영자가 위탁기관별 협상가(customAmount)·주기를 설정한다.
// customAmount가 있으면 그 금액을, 없으면 표준 월정액(PLAN_PRICES)을 사용.

export const PLAN_PRICES: Record<string, number> = {
  STARTER: 49000,
  STANDARD: 99000,
  PRO: 199000,
};

export const PLAN_NAMES: Record<string, string> = {
  STARTER: "Able-Link 스타터",
  STANDARD: "Able-Link 스탠다드",
  PRO: "Able-Link 프로",
};

export type BillingCycle = "MONTHLY" | "ANNUAL";

export function normalizeCycle(c: string | null | undefined): BillingCycle {
  return c === "ANNUAL" ? "ANNUAL" : "MONTHLY";
}

export function cycleLabel(cycle: BillingCycle): string {
  return cycle === "ANNUAL" ? "연" : "월";
}

// 위탁기관의 실제 청구 금액·주기. 운영자 협상가 우선.
export function effectiveBilling(agency: {
  planType: string;
  billingCycle?: string | null;
  customAmount?: number | null;
}): { amount: number; cycle: BillingCycle } {
  const standard = PLAN_PRICES[agency.planType] ?? 0;
  const cycle = normalizeCycle(agency.billingCycle);
  const amount = agency.customAmount != null && agency.customAmount > 0 ? agency.customAmount : standard;
  return { amount, cycle };
}

// cron 반복결제 orderId = agency × 결제일(KST yyyymmdd) × plan.
//  anchor가 안정된 nextBillingAt이라 재시도는 같은 날→동일 orderId(멱등 복구)이고, 연속 두 주기는
//  ~한 달 차이라 날짜가 달라 월충돌(bug B) 없음. (수동 구독은 buildSubscribeOrderId — 이벤트 키 사용.)
export function buildBillingOrderId(agencyId: string | number | bigint, at: Date, planType: string): string {
  const kst = new Date(at.getTime() + 9 * 3600 * 1000);
  const period = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  return `ablelink_${agencyId}_${period}_${planType}`;
}

// 수동 초기구독 orderId = agency × billingEpoch(이벤트 키) × plan. ★시간 미포함 — 근본 해결.
//  · 같은 구독 이벤트의 DB반영 실패 재시도: epoch 불변 → 같은 orderId → Toss ALREADY_PROCESSED 멱등 복구
//    (자정/월경계 무관 — 시간 기준 orderId의 이중청구 문제 제거).
//  · 해지→재구독: 해지 때 epoch +1 → 새 orderId → 실결제(같은 달이어도 무료사이클 없음 — 3차 감사 회귀 제거).
//  · plan 변경(무해지): plan 성분이 달라 새 orderId → 실결제(#4).
export function buildSubscribeOrderId(agencyId: string | number | bigint, billingEpoch: number, planType: string): string {
  return `ablelink_${agencyId}_e${billingEpoch}_${planType}`;
}

// 다음 결제일 = 현재 결제일 + 1주기.
// 말일(29-31) 주의: setMonth/setFullYear는 원일이 대상 달에 없으면 다음 달로 넘쳐(1/31→"2/31"→3/3)
// 한 달을 통째로 건너뛴다. → 1일로 이동해 오버플로우를 막고, 대상 달 말일로 clamp.
// ★anchorDay(G): clamp 기준일은 '가입 시 원일'이어야 한다. from(=저장된 직전 결제일)의 day를 쓰면 짧은 달을
//  한 번 지나며 28로 clamp된 값이 영구 고착돼(31→28→28…) 청구일이 계속 당겨진다. 호출부가 구독 원일을
//  넘기면 31→2월28→3월31로 원일을 복원한다. (미지정 시 종전대로 from의 day — 하위호환)
export function advanceBilling(from: Date, cycle: BillingCycle, anchorDay?: number): Date {
  const d = new Date(from);
  const day = anchorDay && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : d.getDate();
  d.setDate(1);
  if (cycle === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDayOfTarget));
  return d;
}
