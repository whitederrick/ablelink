// lib/validateBRN.ts
// 한국 사업자등록번호(10자리) 검증 — 형식 + 국세청 체크섬.
// 프론트(사업주 정보 입력)·백엔드(agency-profile PATCH)에서 공용.

/** 하이픈/공백 제거 후 숫자만 추출 */
export function normalizeBRN(input: string): string {
  return (input || "").replace(/\D/g, "");
}

/** 123-45-67890 형태로 포맷(10자리일 때만) */
export function formatBRN(input: string): string {
  const d = normalizeBRN(input).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/**
 * 국세청 사업자등록번호 체크섬 검증.
 * 가중치 [1,3,7,1,3,7,1,3,5], 9번째 자리는 (d9*5)의 십의 자리를 더한다.
 * 검증값 = (10 - (합 % 10)) % 10, 마지막 자리와 일치해야 유효.
 */
export function isValidBRN(input: string): boolean {
  const d = normalizeBRN(input);
  if (d.length !== 10) return false;
  const n = d.split("").map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * weights[i];
  sum += Math.floor((n[8] * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === n[9];
}
