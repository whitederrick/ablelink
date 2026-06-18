// lib/verify/account.ts
// 계좌 예금주 조회(실명 확인) — provider 추상화.
// 원칙: 통장 이미지 비보관. 은행+계좌번호로 "등록된 예금주명"만 조회해 기대 성명과 대조.
//
// ⚠️ 현재는 골격(P1). 실제 동작에는 벤더 키가 필요하다.
//   - 키 미설정 시 { configured: false } 반환 → 라우트는 503로 안내(가짜 성공 금지).
//   - 벤더 확정(토스/포트원 등) 후 callProvider() 안의 HTTP 호출만 채우면 즉시 가동.
//
// 환경변수(예): ACCOUNT_VERIFY_PROVIDER, ACCOUNT_VERIFY_SECRET_KEY (벤더 확정 시 docs/env-vars.md 반영)

export type AccountVerifyInput = {
  bankCode?: string | null;   // 표준 은행 코드(있으면 우선)
  bankName?: string | null;   // 은행명(코드 미보유 시 — provider가 매핑)
  accountNumber: string;
  expectedHolder?: string | null; // 기대 예금주명(대조용)
};

export type AccountVerifyResult =
  | { configured: false }
  | { configured: true; ok: false; message: string }
  | {
      configured: true;
      ok: true;
      holderName: string;          // 조회된 예금주명
      matched: boolean;            // expectedHolder와 일치 여부
      method: "NAME_INQUIRY";
      bankCode?: string | null;
    };

function isConfigured(): boolean {
  return !!process.env.ACCOUNT_VERIFY_SECRET_KEY;
}

// 공백·괄호 제거 후 비교(동명이인은 별도 본인인증 CI로 분별 — P3/P4)
function normalizeName(s: string): string {
  return (s || "").replace(/\s|\(.*?\)/g, "").trim();
}

/**
 * 예금주 조회 실행. 키 미설정이면 configured:false.
 * 사용자(직무지도원) 행동 없이 매니저가 계좌번호만으로 호출(고령·앱없음 대응).
 */
export async function verifyAccountHolder(input: AccountVerifyInput): Promise<AccountVerifyResult> {
  if (!isConfigured()) return { configured: false };

  const accountNumber = (input.accountNumber || "").replace(/\D/g, "");
  if (!accountNumber) return { configured: true, ok: false, message: "계좌번호를 입력해주세요." };

  try {
    const holderName = await callProvider({ ...input, accountNumber });
    if (!holderName) return { configured: true, ok: false, message: "예금주를 조회할 수 없습니다. 은행/계좌번호를 확인해주세요." };
    const matched = input.expectedHolder
      ? normalizeName(holderName) === normalizeName(input.expectedHolder)
      : true;
    return { configured: true, ok: true, holderName, matched, method: "NAME_INQUIRY", bankCode: input.bankCode ?? null };
  } catch (e: any) {
    console.error("[verify/account] provider error:", e?.message ?? e);
    return { configured: true, ok: false, message: "계좌 인증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }
}

/**
 * 벤더 HTTP 호출(예금주명 반환). 벤더 확정 후 구현.
 * 토스/포트원/금결원 등 예금주조회 API를 여기서 호출하고 예금주명을 반환한다.
 */
async function callProvider(_input: AccountVerifyInput & { accountNumber: string }): Promise<string | null> {
  // TODO(P1 활성화): 벤더 확정 후 fetch 구현.
  //   const res = await fetch(`${PROVIDER_API}/...`, { headers: { Authorization: ... }, ... });
  //   return res.account_holder_name ?? null;
  throw new Error("ACCOUNT_VERIFY_PROVIDER_NOT_IMPLEMENTED");
}
