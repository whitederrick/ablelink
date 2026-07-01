// lib/plans.ts
// 위탁기관(Agency) 구독 플랜 분류 단일 소스.
// ⚠️ 플랜 값 추가/변경 시 여기만 고치면 됨 — 과거엔 allowlist(["STARTER","STANDARD","PRO"])와
//    denylist(!== "FREE" && !== "TRIAL")가 코드 곳곳에 흩어져, 새 플랜 추가 시 한 곳은 유료·다른 곳은 무료로
//    갈리는 불일치 위험이 있었음. 이를 제거하기 위해 중앙화.

import type { AgencyPlanType } from "@prisma/client";

/** 유료 구독(과금 대상) 플랜 */
export const PAID_AGENCY_PLANS: AgencyPlanType[] = ["STARTER", "STANDARD", "PRO"];

/** 프리미엄 기능(AI·PDF 등) 사용 가능 플랜 = 유료 + 체험(TRIAL) */
export const PREMIUM_FEATURE_PLANS: AgencyPlanType[] = ["STARTER", "STANDARD", "PRO", "TRIAL"];

/** 유료 구독(과금 대상)인가 */
export function isPaidAgencyPlan(p: string | null | undefined): boolean {
  return !!p && (PAID_AGENCY_PLANS as string[]).includes(p);
}

/** 프리미엄 기능 사용 가능(유료 또는 체험)인가 */
export function hasPremiumFeatures(p: string | null | undefined): boolean {
  return !!p && (PREMIUM_FEATURE_PLANS as string[]).includes(p);
}
