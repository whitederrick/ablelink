// admlink-admin/lib/time.ts
// KST(한국 표준시) 관련 유틸리티 함수들

export function getKstDateString(date = new Date()) {
  // KST(UTC+9) 기준으로 YYYY-MM-DD 생성
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
}