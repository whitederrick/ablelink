// lib/payroll/calendarMonths.ts
// 달력 기준 개월 계산 — 4대보험 판정(일용 1개월 미만·고용보험 3개월 계속근로)의 단일 출처. 모두 UTC 날짜 기준.
//
// 2026-10-08: 계속근로 개월을 '경과일수 ÷ 30'으로 구해, 2월이 낀 기간은 달력으로 3개월이 찬 날에도 3.0에 못 미쳤다
//  (예: 2/1 입사 → 4/30 = 89일 ÷ 30 = 2.97 → 고용보험이 한 달 늦게 시작). 일용 판정(1개월 미만)은 이미 달력 기준이라
//  같은 파일의 기준으로 통일한다.

const DAY_MS = 86400000;

/** start에 n개월 더하기(달력 기준, 말일 클램프). UTC 기준. */
export function addMonthsClampUTC(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return t;
}

/**
 * 계약기간[start, end](양끝 포함)이 달력 기준 1개월 미만인가 → 일용근로자 판정.
 * 1개월 이상 = (start + 1개월) <= (end + 1일). 월별 일수 차이(2월 28/29 등)를 정확히 반영.
 */
export function isUnderOneCalendarMonth(start: Date, end: Date): boolean {
  const startPlus1 = addMonthsClampUTC(start, 1).getTime();
  const endPlus1 = end.getTime() + DAY_MS;
  return startPlus1 > endPlus1;
}

/**
 * start 기산 n개월 기간의 마지막 날(UTC 자정). 민법 제160조: 최후 월에 기산일에 해당하는 날이 있으면 그 전일,
 * 없으면(1/31 + 1개월 등) 그 월의 말일에 만료. (addMonthsClampUTC가 말일로 클램프한 경우가 후자.)
 */
function lastDayOfMonths(start: Date, n: number): number {
  const target = addMonthsClampUTC(start, n);
  const clamped = target.getUTCDate() !== start.getUTCDate();
  return clamped ? target.getTime() : target.getTime() - DAY_MS;
}

/**
 * [start, end](양끝 포함) 사이 달력 기준 경과 개월(소수 포함).
 *  · 정수부 = end >= (n개월 기간의 마지막 날)을 만족하는 최대 n → 3개월이 찬 날 정확히 3.0 이상.
 *  · 소수부 = 다음 개월 구간 안에서 지난 일수 비율(표시·참고용).
 *  end < start 이면 0.
 */
export function calendarMonthsElapsed(start: Date, end: Date): number {
  const endPlus1 = end.getTime() + DAY_MS;
  if (endPlus1 <= start.getTime()) return 0;
  let n = 0;
  while (end.getTime() >= lastDayOfMonths(start, n + 1)) n++;
  const lo = addMonthsClampUTC(start, n).getTime();
  const hi = addMonthsClampUTC(start, n + 1).getTime();
  // 소수부는 1에 도달하지 못하게 제한 — 다음 개월이 '완료'되는 순간은 위 정수부(n+1)가 결정한다(경계에서 합이 정수로 올라가지 않게).
  return n + Math.min((endPlus1 - lo) / (hi - lo), 0.99);
}
