// lib/verify/identity.ts
// 본인 확인(신원) — 휴대폰/카카오 본인인증 provider 추상화.
// 원칙: 신분증 이미지·주민번호 비보관. 인증 결과값(성명·생년월일·CI/DI)만 받아 저장.
//
// ⚠️ 현재는 골격(P3). 실제 동작에는 벤더 키가 필요하다.
//   - 키 미설정 시 { configured: false } 반환 → 라우트는 503로 안내(가짜 성공 금지).
//   - 디지털 본인인증 흐름: 프론트가 벤더 SDK로 인증창 → 토큰(imp_uid 등) 수신 → 서버로 전달
//     → 서버가 토큰으로 벤더 API 검증 → 결과값(성명·생년월일·CI 등)만 추출·저장.
//   - 대면(INPERSON) 확인은 벤더 불필요(매니저 attest) — 별도 처리(라우트).
//
// 환경변수(예): IDENTITY_VERIFY_PROVIDER, IDENTITY_VERIFY_SECRET_KEY (벤더 확정 시 docs/env-vars.md 반영)

export type IdentityVerifyResult =
  | { configured: false }
  | { configured: true; ok: false; message: string }
  | {
      configured: true;
      ok: true;
      name: string;
      birthDate?: string | null; // YYYY-MM-DD
      ci?: string | null;        // 연계정보(가명 식별자) — 주민번호 아님
      phone?: string | null;
      method: "MOBILE" | "KAKAO";
    };

function isConfigured(): boolean {
  return !!process.env.IDENTITY_VERIFY_SECRET_KEY;
}

/**
 * 프론트 본인인증 완료 토큰 → 서버 검증 → 결과값.
 * 키 미설정이면 configured:false (가짜 성공 금지).
 */
export async function verifyIdentityToken(token: string): Promise<IdentityVerifyResult> {
  if (!isConfigured()) return { configured: false };
  if (!token?.trim()) return { configured: true, ok: false, message: "인증 토큰이 없습니다." };

  try {
    const data = await callProvider(token.trim());
    if (!data?.name) return { configured: true, ok: false, message: "본인 인증 결과를 확인할 수 없습니다." };
    return {
      configured: true,
      ok: true,
      name: data.name,
      birthDate: data.birthDate ?? null,
      ci: data.ci ?? null,
      phone: data.phone ?? null,
      method: data.method ?? "MOBILE",
    };
  } catch (e: any) {
    console.error("[verify/identity] provider error:", e?.message ?? e);
    return { configured: true, ok: false, message: "본인 인증 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요." };
  }
}

type ProviderIdentity = { name: string; birthDate?: string | null; ci?: string | null; phone?: string | null; method?: "MOBILE" | "KAKAO" };

/**
 * 벤더 본인인증 검증 API 호출. 벤더 확정 후 구현.
 * 토스/포트원 등 본인확인 결과 조회 API를 호출하고 결과값(성명·생년월일·CI 등)을 반환한다.
 * 신분증 이미지·주민번호는 받지도 저장하지도 않는다.
 */
async function callProvider(_token: string): Promise<ProviderIdentity | null> {
  // TODO(P3 활성화): 벤더 확정 후 fetch 구현.
  //   const res = await fetch(`${PROVIDER_API}/certifications/${_token}`, { headers: { Authorization: ... } });
  //   return { name, birthDate, ci, phone, method };
  throw new Error("IDENTITY_VERIFY_PROVIDER_NOT_IMPLEMENTED");
}
