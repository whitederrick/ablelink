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

function won(n: number): string { return `${Math.round(n).toLocaleString()}원`; }
function hStr(min: number): string {
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export function computeWeeklyHoliday(input: WeeklyHolidayInput): WeeklyHolidayResult {
  const { days, workDaysPerWeek, ordinaryWage, flatWeeklyHolidayPay } = input;

  // 주차별 집계
  const byWeek = new Map<string, { workedDays: Set<string>; minutes: number }>();
  for (const dw of days) {
    const key = isoWeekKey(dw.dateISO);
    let w = byWeek.get(key);
    if (!w) { w = { workedDays: new Set(), minutes: 0 }; byWeek.set(key, w); }
    w.workedDays.add(dw.dateISO);
    w.minutes += dw.scheduledMinutes;
  }

  const weekKeys = [...byWeek.keys()].sort();
  const weekCount = weekKeys.length;
  const totalMinutes = weekKeys.reduce((s, k) => s + byWeek.get(k)!.minutes, 0);
  const avgWeeklyMinutes = weekCount > 0 ? Math.round(totalMinutes / weekCount) : 0;
  const meets15h = weekCount > 0 && avgWeeklyMinutes >= WEEKLY_THRESHOLD_MIN;

  const minDays = Math.max(1, workDaysPerWeek || 5);

  const weeks: WeekResult[] = weekKeys.map((key) => {
    const w = byWeek.get(key)!;
    const workedDays = w.workedDays.size;
    const fullAttendance = workedDays >= minDays;
    const eligible = fullAttendance && meets15h;
    let holidayPay = 0;
    if (eligible) {
      holidayPay = flatWeeklyHolidayPay != null && flatWeeklyHolidayPay > 0
        ? Math.round(flatWeeklyHolidayPay)
        : Math.round((w.minutes / 60 / 40) * 8 * ordinaryWage);
    }
    return { weekKey: key, workedDays, scheduledMinutes: w.minutes, fullAttendance, eligible, holidayPay };
  });

  const eligibleWeeks = weeks.filter(w => w.eligible).length;
  const totalHolidayPay = weeks.reduce((s, w) => s + w.holidayPay, 0);

  let calcMethod = "";
  if (eligibleWeeks > 0) {
    if (flatWeeklyHolidayPay != null && flatWeeklyHolidayPay > 0) {
      calcMethod = `${eligibleWeeks}주 적격 × ${won(flatWeeklyHolidayPay)}`;
    } else {
      const sample = weeks.find(w => w.eligible)!;
      calcMethod = `${eligibleWeeks}주 적격 · 주 소정 ${hStr(sample.scheduledMinutes)}: (소정÷40×8×${won(ordinaryWage)})`;
    }
  }

  return { weeks, avgWeeklyMinutes, meets15h, eligibleWeeks, totalHolidayPay, calcMethod };
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
