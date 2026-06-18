// lib/verify/payoutEligibility.ts
// 급여 이체 자격 판정 (P4 골격).
// 계약 당사자 = 계좌주 = 본인 동일성을 "검증 결과값"으로 판정한다.
//  - 계좌 예금주 검증(accountHolderVerified) + 본인 확인(identityVerifiedAt) 둘 다 충족 시 이체 가능.
//  - CI ↔ 예금주명 정밀 동일성은 본인인증 CI·예금주명이 실제로 채워진 뒤(P1/P3 가동) 강화한다(아래 TODO).
//
// 사용처(예정): 급여 자동이체 실행 직전 게이트([[payroll_automation_design_2026_06_16]]).
//   const g = payoutGate(worker); if (!g.eligible) skip/hold(g.reason);

export type WorkerVerifyFields = {
  accountHolderVerified?: boolean | null;
  accountVerifiedAt?: Date | string | null;
  identityVerifiedAt?: Date | string | null;
  // 정밀 동일성용(P1/P3 가동 후): ci(본인인증) / accountHolder(예금주명)
  ci?: string | null;
};

export function isAccountVerified(w: WorkerVerifyFields): boolean {
  return w.accountHolderVerified === true;
}

export function isIdentityVerified(w: WorkerVerifyFields): boolean {
  return !!w.identityVerifiedAt;
}

export type PayoutGate = { eligible: boolean; reason?: "ACCOUNT_UNVERIFIED" | "IDENTITY_UNVERIFIED"; message?: string };

/** 급여 이체 가능 여부 + 막힌 사유. 자동이체 실행 직전에 호출. */
export function payoutGate(w: WorkerVerifyFields): PayoutGate {
  if (!isAccountVerified(w)) {
    return { eligible: false, reason: "ACCOUNT_UNVERIFIED", message: "계좌 예금주 확인이 필요합니다." };
  }
  if (!isIdentityVerified(w)) {
    return { eligible: false, reason: "IDENTITY_UNVERIFIED", message: "본인 확인이 필요합니다." };
  }
  // TODO(P4 강화): CI ↔ 예금주명 정밀 동일성 비교(동명이인 분별). CI·예금주명이 실제로 채워진 뒤 활성화.
  return { eligible: true };
}

/** 검증 종합 상태(화면 표시용). */
export function verificationSummary(w: WorkerVerifyFields): { accountVerified: boolean; identityVerified: boolean; fullyVerified: boolean } {
  const accountVerified = isAccountVerified(w);
  const identityVerified = isIdentityVerified(w);
  return { accountVerified, identityVerified, fullyVerified: accountVerified && identityVerified };
}
