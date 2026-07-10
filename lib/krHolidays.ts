// lib/krHolidays.ts — 한국 공휴일 정적 데이터 (2024-2027)

const KR_HOLIDAYS: Record<string, string> = {
  // 2024
  "2024-01-01": "신정", "2024-02-09": "설날 연휴", "2024-02-10": "설날", "2024-02-11": "설날 연휴", "2024-02-12": "설날(대체)",
  "2024-03-01": "삼일절", "2024-04-10": "국회의원선거일", "2024-05-05": "어린이날",
  "2024-05-06": "어린이날(대체)", "2024-05-15": "부처님오신날", "2024-06-06": "현충일",
  "2024-08-15": "광복절", "2024-09-16": "추석 연휴", "2024-09-17": "추석", "2024-09-18": "추석 연휴",
  "2024-10-03": "개천절", "2024-10-09": "한글날", "2024-12-25": "성탄절",
  // 2025
  "2025-01-01": "신정", "2025-01-27": "임시공휴일", "2025-01-28": "설날 연휴", "2025-01-29": "설날", "2025-01-30": "설날 연휴",
  "2025-03-01": "삼일절", "2025-03-03": "삼일절(대체)", "2025-05-05": "어린이날",
  "2025-05-06": "부처님오신날", "2025-06-06": "현충일", "2025-08-15": "광복절",
  "2025-10-03": "개천절", "2025-10-05": "추석 연휴", "2025-10-06": "추석", "2025-10-07": "추석 연휴",
  "2025-10-08": "추석 연휴(대체)", "2025-10-09": "한글날", "2025-12-25": "성탄절",
  // 2026
  "2026-01-01": "신정", "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절", "2026-03-02": "삼일절(대체)", "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날", "2026-05-25": "부처님오신날(대체)", "2026-06-06": "현충일",
  "2026-08-15": "광복절", "2026-08-17": "광복절(대체)",
  "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
  "2026-10-03": "개천절", "2026-10-05": "개천절(대체)", "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  // 2027 (설날 당일 2/6토→연휴 2/5·6·7+대체 2/8, 추석 당일 9/15수→연휴 9/14·15·16)
  "2027-01-01": "신정", "2027-02-05": "설날 연휴", "2027-02-06": "설날", "2027-02-07": "설날 연휴", "2027-02-08": "설날(대체)",
  "2027-03-01": "삼일절", "2027-05-05": "어린이날", "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일", "2027-08-15": "광복절", "2027-08-16": "광복절(대체)",
  "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴",
  "2027-10-03": "개천절", "2027-10-04": "개천절(대체)", "2027-10-09": "한글날", "2027-10-11": "한글날(대체)",
  "2027-12-25": "성탄절", "2027-12-27": "성탄절(대체)",
};

// 데이터가 커버하는 연도 범위(정적 데이터에서 자동 도출 — 데이터 추가 시 자동 확장).
const COVERAGE_YEARS = Object.keys(KR_HOLIDAYS).map((d) => Number(d.slice(0, 4)));
const COVERAGE_MIN = Math.min(...COVERAGE_YEARS);
const COVERAGE_MAX = Math.max(...COVERAGE_YEARS);

// 범위 밖 연도가 조회되면 조용히 '공휴일 0'을 반환하는 대신 연도별 1회 경고.
// (급여 분모·휴일가산·주휴·결근 판정이 조용히 틀어지는 시한폭탄 방지)
const warnedYears = new Set<number>();
function assertYearCovered(year: number): void {
  if (year >= COVERAGE_MIN && year <= COVERAGE_MAX) return;
  if (warnedYears.has(year)) return;
  warnedYears.add(year);
  console.warn(
    `[krHolidays] ${year}년 공휴일 데이터 없음(커버 ${COVERAGE_MIN}~${COVERAGE_MAX}). ` +
      `공휴일이 0으로 처리되어 급여·결근·문서 계산이 어긋날 수 있음 — lib/krHolidays.ts에 해당 연도 데이터 추가 필요.`,
  );
}

export function getKrHolidays(year: number, month: number): Record<string, string> {
  assertYearCovered(year);
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const result: Record<string, string> = {};
  for (const [date, name] of Object.entries(KR_HOLIDAYS)) {
    if (date.startsWith(prefix)) result[date] = name;
  }
  return result;
}

/** [startYmd, endYmd] 범위 내 공휴일 날짜(YYYY-MM-DD) 목록 */
export function getKrHolidayDates(startYmd: string, endYmd: string): string[] {
  const startYear = Number(startYmd.slice(0, 4));
  const endYear = Number(endYmd.slice(0, 4));
  for (let y = startYear; y <= endYear; y++) assertYearCovered(y);
  return Object.keys(KR_HOLIDAYS).filter((d) => d >= startYmd && d <= endYmd).sort();
}

export function isKrHoliday(ymd: string): boolean {
  assertYearCovered(Number(ymd.slice(0, 4)));
  return ymd in KR_HOLIDAYS;
}
