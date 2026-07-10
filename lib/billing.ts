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

// 결제 orderId = agency × 결제일(KST yyyymmdd) × plan.
//  plan 포함: 같은 날 플랜을 바꿔도 새 orderId로 실제 결제(무료 상향 방지, #4).
//  ★날짜(월 아님) 기준: 월 기준이면 결제일 KST(UTC+9h) 변환이 말일±UTC창에서 연속 두 주기를 같은 달로
//   접어 orderId가 충돌 → 둘째 청구가 ALREADY_PROCESSED로 스킵돼 한 주기 무료가 됨(B). 결제일은 주기마다
//   ~한 달 차이라 날짜 기준이면 절대 충돌 안 함. 같은 결제일 재시도는 여전히 동일 orderId → Toss 멱등 복구.
export function buildBillingOrderId(agencyId: string | number | bigint, at: Date, planType: string): string {
  const kst = new Date(at.getTime() + 9 * 3600 * 1000);
  const period = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  return `ablelink_${agencyId}_${period}_${planType}`;
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
