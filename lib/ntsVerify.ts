// lib/ntsVerify.ts
// 국세청 사업자등록정보 진위확인 API 연동

export type NtsVerifyResult = {
  valid: boolean | null; // null = API 키 없음 or 오류
  businessName: string | null;
  status: string | null;
};

/**
 * 사업자등록번호 10자리를 국세청 API로 검증합니다.
 * NTS_API_KEY 환경변수가 없으면 { valid: null, businessName: null, status: null } 반환.
 * 네트워크 오류 등 예외 발생 시에도 null 반환.
 */
export async function verifyBusinessNumber(bno: string): Promise<NtsVerifyResult> {
  const apiKey = process.env.NTS_API_KEY;
  if (!apiKey) {
    return { valid: null, businessName: null, status: null };
  }

  // 하이픈 제거 후 10자리 숫자만
  const cleaned = bno.replace(/-/g, "").trim();
  if (!/^\d{10}$/.test(cleaned)) {
    return { valid: false, businessName: null, status: null };
  }

  try {
    const res = await fetch(
      "https://api.odcloud.kr/api/nts-businessman/v1/validate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Infuser ${apiKey}`,
        },
        body: JSON.stringify({ businesses: [{ b_no: cleaned }] }),
      }
    );

    if (!res.ok) {
      return { valid: null, businessName: null, status: null };
    }

    const data = await res.json();
    // 응답 구조: { data: [{ b_no, valid, b_stt, b_stt_cd, tax_type, ... }] }
    const item = data?.data?.[0];
    if (!item) {
      return { valid: null, businessName: null, status: null };
    }

    const valid = item.valid === "01"; // "01" = 정상 사업자
    const businessName: string | null = item.tax_type ?? item.b_stt ?? null;
    const status: string | null = item.b_stt ?? null;

    return { valid, businessName, status };
  } catch {
    return { valid: null, businessName: null, status: null };
  }
}
