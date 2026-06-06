// lib/billing.ts
// 결제 금액·주기 계산. 할인 정책은 코드에 박지 않고, 운영자가 에이전시별 협상가(customAmount)·주기를 설정한다.
// customAmount가 있으면 그 금액을, 없으면 표준 월정액(PLAN_PRICES)을 사용.

export const PLAN_PRICES: Record<string, number> = {
  STARTER: 49000,
  STANDARD: 99000,
  PRO: 199000,
};

export const PLAN_NAMES: Record<string, string> = {
  STARTER: "AbleLink 스타터",
  STANDARD: "AbleLink 스탠다드",
  PRO: "AbleLink 프로",
};

export type BillingCycle = "MONTHLY" | "ANNUAL";

export function normalizeCycle(c: string | null | undefined): BillingCycle {
  return c === "ANNUAL" ? "ANNUAL" : "MONTHLY";
}

export function cycleLabel(cycle: BillingCycle): string {
  return cycle === "ANNUAL" ? "연" : "월";
}

// 에이전시의 실제 청구 금액·주기. 운영자 협상가 우선.
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

// 다음 결제일 = 현재 결제일 + 1주기.
export function advanceBilling(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from);
  if (cycle === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}
