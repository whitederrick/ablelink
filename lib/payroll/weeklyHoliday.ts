// lib/payroll/weeklyHoliday.ts
// 주휴수당 적격 판정·산식 (단시간 근로자) — 순수함수, 급여 계산엔진에서 사용.
//
// 법적 2조건(모두 충족 시 1주 1일 유급 주휴일 + 주휴수당):
//   ① 그 주 소정근로일을 개근(결근 0).
//   ② 4주 평균 1주 소정근로시간 ≥ 15시간.
//
// 본 구현(2026-06-10 사용자 확정):
//   - 개근 = 그 주 확정 출근일수 ≥ 소정근로일수(workDaysPerWeek). 결근이 시스템에 별도 기록되지
//     않으므로 "소정일수만큼 출근=개근" 프록시.
//   - 4주 평균은 해당 급여월의 주차별 소정근로시간 평균으로 판정(미만이면 그 달 주휴 전부 미발생).
//   - 주휴수당액 = (주 소정근로시간 ÷ 40) × 8 × 통상시급. flatWeeklyHolidayPay가 주어지면 그 값(수동 오버라이드).

export interface DayWork {
  /** KST 근무일 "YYYY-MM-DD" */
  dateISO: string;
  /** 그 날의 소정근로시간(분) — 근무형태 기준(휴게·출퇴근지도 제외) */
  scheduledMinutes: number;
}

export interface WeeklyHolidayInput {
  days: DayWork[];
  /** 소정근로일수/주 (계약서 workDaysPerWeek, 기본 5) */
  workDaysPerWeek: number;
  /** 통상시급(원) */
  ordinaryWage: number;
  /** 주당 고정 주휴수당(수동 오버라이드). null/undefined면 자동 산식 */
  flatWeeklyHolidayPay?: number | null;
  /** 소정근로 요일 집합(0=일..6=토). 공휴일이 소정근로일에 걸렸는지 판정용. 없으면 월~금 가정. */
  workingWeekdays?: Set<number>;
  /**
   * 공휴일+커스텀휴무 "YYYY-MM-DD" 집합. 공휴일은 소정근로일이 아니므로(법정 유급휴일)
   * 그 주 소정근로일수에서 제외한다 → 공휴일 낀 주도 나머지 소정근로일만 개근하면 주휴 지급.
   */
  holidaySet?: Set<string>;
  /**
   * 급여기간 경계 "YYYY-MM-DD"(선택). 주면 기간 내 모든 주를 미리 seed 하여
   * "출근 기록이 전혀 없는 주(결근주/무출근주)"도 부적격 주로 명시한다.
   * (없으면 출근한 주만 집계되어 결근주가 주차 목록에서 사라져 판정이 왜곡됨)
   * 주휴수당액에는 영향 없음(결근주는 어차피 0원) — 주차 목록·집계의 정확성만 보정.
   */
  periodStart?: string;
  periodEnd?: string;
  /**
   * P1-11: 월 경계 주(週) 귀속 정책 "YYYY-MM"(선택). 주면 "주가 끝나는(일요일이 속한) 달"이 이 값과
   * 같은 주만 이 달에 귀속시켜 지급한다. days에는 인접 달(전월 말) 출근까지 넣어 경계주 만근을 온전히
   * 판정하되, 지급·집계는 이 달에 끝나는 주로 한정한다. (미지정 시 종전대로 days에 담긴 모든 주 집계.)
   */
  payMonth?: string;
}

export interface WeekResult {
  weekKey: string;        // ISO 주차 키 (예: "2026-W24")
  workedDays: number;
  scheduledMinutes: number;
  fullAttendance: boolean; // 조건①
  eligible: boolean;       // 조건① && 조건②
  holidayPay: number;
}

export interface WeeklyHolidayResult {
  weeks: WeekResult[];
  avgWeeklyMinutes: number;
  meets15h: boolean;       // 조건②
  eligibleWeeks: number;
  totalHolidayPay: number;
  calcMethod: string;      // 명세서 계산방법 문자열
}

const WEEKLY_THRESHOLD_MIN = 15 * 60; // 15시간

/** KST 날짜 문자열 → ISO 주차 키("YYYY-Www"). 월~일 기준 ISO-8601. */
export function isoWeekKey(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  // UTC 기준으로 계산(요일·주차는 tz 무관하게 일관). KST 날짜를 그대로 사용.
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7;        // 일=0 → 7 (월=1..일=7)
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // 그 주 목요일로 이동
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 그 날짜가 속한 ISO 주(월~일)의 일요일(주 끝) "YYYY-MM-DD". 주 귀속월 판정용. */
export function isoWeekEndISO(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay() || 7;          // 월=1..일=7
  dt.setUTCDate(dt.getUTCDate() + (7 - dow)); // 그 주 일요일로 이동
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** [startISO, endISO] 사이 모든 날짜를 "YYYY-MM-DD"(KST 날짜문자열)로 순회. */
function* eachDateISO(startISO: string, endISO: string): Generator<string> {
  const [sy, sm, sd] = startISO.split("-").map(Number);
  const [ey, em, ed] = endISO.split("-").map(Number);
  if (!sy || !ey) return;
  let cur = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  while (cur <= end) {
    const d = new Date(cur);
    yield `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    cur += 86400000;
  }
}

function won(n: number): string { return `${Math.round(n).toLocaleString()}원`; }
function hStr(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export function computeWeeklyHoliday(input: WeeklyHolidayInput): WeeklyHolidayResult {
  const { days, workDaysPerWeek, ordinaryWage, flatWeeklyHolidayPay } = input;
  const workingWeekdays = input.workingWeekdays ?? new Set([1, 2, 3, 4, 5]); // 기본 월~금
  const holidaySet = input.holidaySet ?? new Set<string>();

  const payMonth = input.payMonth;

  // 주차별 출근 집계 (endISO = 그 주 일요일 = 귀속월 판정 기준)
  const byWeek = new Map<string, { workedDays: Set<string>; minutes: number; endISO: string }>();
  for (const dw of days) {
    const key = isoWeekKey(dw.dateISO);
    let w = byWeek.get(key);
    if (!w) { w = { workedDays: new Set(), minutes: 0, endISO: isoWeekEndISO(dw.dateISO) }; byWeek.set(key, w); }
    w.workedDays.add(dw.dateISO);
    w.minutes += dw.scheduledMinutes;
  }

  // 결근주/무출근주 명시: 급여기간 내 모든 주를 seed → 출근 0인 주도 부적격 주로 남는다.
  // (기간이 주어지지 않으면 종전대로 출근한 주만 집계)
  //  ★payMonth 지정 시엔 "주가 끝나는 달==payMonth"인 주만 seed/집계한다(P1-11 경계주 귀속).
  if (input.periodStart && input.periodEnd) {
    for (const ymd of eachDateISO(input.periodStart, input.periodEnd)) {
      const endISO = isoWeekEndISO(ymd);
      if (payMonth && endISO.slice(0, 7) !== payMonth) continue;
      const key = isoWeekKey(ymd);
      if (!byWeek.has(key)) byWeek.set(key, { workedDays: new Set(), minutes: 0, endISO });
    }
  }

  // 주차별 "소정근로일에 걸린 공휴일수" — 그 주 소정근로일수를 그만큼 줄인다.
  // (공휴일은 소정근로일이 아니므로, 공휴일에 쉬어도 결근 아님 → 개근 판정에서 제외)
  const holidayWorkdayByWeek = new Map<string, number>();
  for (const h of holidaySet) {
    const [hy, hm, hd] = h.split("-").map(Number);
    if (!hy || !hm || !hd) continue;
    const dow = new Date(Date.UTC(hy, hm - 1, hd)).getUTCDay();
    if (!workingWeekdays.has(dow)) continue; // 주말 등 애초에 소정근로일 아닌 공휴일은 무영향
    const key = isoWeekKey(h);
    holidayWorkdayByWeek.set(key, (holidayWorkdayByWeek.get(key) ?? 0) + 1);
  }

  // payMonth 지정 시 "주가 끝나는 달==payMonth"인 주만 지급·집계 대상(경계주는 끝나는 달로 귀속).
  const weekKeys = [...byWeek.keys()]
    .filter((k) => !payMonth || byWeek.get(k)!.endISO.slice(0, 7) === payMonth)
    .sort();
  const weekCount = weekKeys.length;

  // 1주 소정근로시간(초단시간 15h 판정·주휴수당액) = 평균 1일 소정 × 주 소정근로일수.
  // 통상적인 1주 기준이며 공휴일·부분주로 줄지 않는다(주휴는 공휴일 있는 주에도 1일분 지급).
  // #3: payMonth 지정 시 '이 달에 귀속되는 주'의 날만 평균에 사용 — days엔 경계주 만근 판정용으로
  //  전월 말(lookback) 출근도 들어오는데, 그 전월 소정시간까지 평균에 섞으면 근무형태가 월 경계에서
  //  바뀐 경우 이 달 주휴액·15h 판정이 전월 시간에 오염된다. (contractDailySojeMin 있으면 값이 균일해 무영향)
  const dailyMinsList = days
    .filter(d => !payMonth || isoWeekEndISO(d.dateISO).slice(0, 7) === payMonth)
    .map(d => d.scheduledMinutes)
    .filter(m => m > 0);
  const avgDailyMin = dailyMinsList.length ? Math.round(dailyMinsList.reduce((s, m) => s + m, 0) / dailyMinsList.length) : 0;
  const wpw = Math.max(1, workDaysPerWeek || 5);
  const typicalWeeklyMinutes = avgDailyMin * wpw;
  const meets15h = weekCount > 0 && typicalWeeklyMinutes >= WEEKLY_THRESHOLD_MIN;

  const autoWeeklyPay = Math.round((typicalWeeklyMinutes / 60 / 40) * 8 * ordinaryWage);
  const perWeekPay = flatWeeklyHolidayPay != null && flatWeeklyHolidayPay > 0
    ? Math.round(flatWeeklyHolidayPay)
    : autoWeeklyPay;

  const weeks: WeekResult[] = weekKeys.map((key) => {
    const w = byWeek.get(key)!;
    const workedDays = w.workedDays.size;
    // 그 주 소정근로일 = 주 소정근로일수 − 그 주 (소정근로 요일에 걸린) 공휴일수.
    const requiredDays = Math.max(0, wpw - (holidayWorkdayByWeek.get(key) ?? 0));
    const fullAttendance = requiredDays > 0 ? workedDays >= requiredDays : workedDays > 0;
    const eligible = fullAttendance && meets15h && workedDays > 0;
    return { weekKey: key, workedDays, scheduledMinutes: w.minutes, fullAttendance, eligible, holidayPay: eligible ? perWeekPay : 0 };
  });

  const eligibleWeeks = weeks.filter(w => w.eligible).length;
  const totalHolidayPay = weeks.reduce((s, w) => s + w.holidayPay, 0);

  let calcMethod = "";
  if (eligibleWeeks > 0) {
    calcMethod = flatWeeklyHolidayPay != null && flatWeeklyHolidayPay > 0
      ? `${eligibleWeeks}주 적격 × ${won(flatWeeklyHolidayPay)}`
      : `${eligibleWeeks}주 적격 · 주 소정 ${hStr(typicalWeeklyMinutes)}: (소정÷40×8×${won(ordinaryWage)})`;
  }

  return { weeks, avgWeeklyMinutes: typicalWeeklyMinutes, meets15h, eligibleWeeks, totalHolidayPay, calcMethod };
}

/** 근무형태 → 1일 소정근로시간(분). 휴게·출퇴근지도 제외(실근로). */
export function scheduledMinutesForWorkType(
  workType: string | null | undefined,
  customStart?: string | null,
  customEnd?: string | null,
): number {
  switch (workType) {
    case "AM":
    case "PM":
      return 240; // 4시간
    case "FULL_DAY":
      return 480; // 8시간
    case "CUSTOM": {
      const s = toMin(customStart), e = toMin(customEnd);
      if (s != null && e != null && e > s) {
        const span = e - s;
        // 4시간 이상이면 휴게 30분 제외(통상), 미만은 그대로.
        return span >= 240 ? span - 30 : span;
      }
      return 240;
    }
    default:
      return 240;
  }
}

function toMin(hhmm?: string | null): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
