// lib/payroll/pensionBase.ts
// 국민연금 기준소득월액 산정(자동 clamp 방식).
//
// 국민연금 보험료 = 기준소득월액 × 요율. 기준소득월액은 월 보수를
//  ① 1,000원 미만 절사 후 ② [하한액, 상한액] 으로 clamp 한 값(매년 7월 고시).
// 파트타임 직무지도원은 하한액 미만 소득자가 많아, 지급액×요율(근사)은 과소공제가 된다.
//  → 하한 clamp 로 이를 바로잡는다. (월단위 정액 — 근무일수 비례 없음)
//
// min/max 가 모두 null 이면 등급표 미설정으로 보고 null 반환(호출부가 종전 근사 유지).

export function standardMonthlyIncome(
  monthlyIncome: number,
  min: number | null | undefined,
  max: number | null | undefined,
): number | null {
  if ((min == null || !(min > 0)) && (max == null || !(max > 0))) return null; // 등급표 미설정
  const floored = Math.floor(Math.max(0, monthlyIncome) / 1000) * 1000; // 1,000원 미만 절사
  let base = floored;
  if (min != null && min > 0 && base < min) base = min; // 하한
  if (max != null && max > 0 && base > max) base = max; // 상한
  return base;
}
