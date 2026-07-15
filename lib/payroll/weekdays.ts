// lib/payroll/weekdays.ts
// ★근무요일(소정근로 요일) 단일 소스. DB(CSV)·급여계산·검증·UI가 전부 이 모듈을 경유해 요일 기준을 통일한다.
//
// 요일 인덱스 기준 = JavaScript getUTCDay()/getDay() 표준: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토.
//  · computeRun·weeklyHoliday가 이미 이 기준(getUTCDay, DOW_LABEL 값)을 쓰므로 동일 기준을 재사용(off-by-one 방지).
//  · EmploymentContract.workingWeekdays = 이 숫자들의 CSV(예: "1,3,5" = 월·수·금). null/빈값 = 미설정 → 파생.
//  · 기존 weeklyHoliday 필드는 한글 라벨("일")이라 여기 LABEL_TO_DOW로 일원 변환한다.

export const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const; // index = getUTCDay()
export const LABEL_TO_DOW: Record<string, number> = { "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6 };

/** "1,3,5" → [1,3,5](정렬·중복제거·0~6 검증). null/빈/형식오류 → null(호출부가 파생으로 폴백). */
export function parseWorkingWeekdays(csv: string | null | undefined): number[] | null {
  if (!csv || typeof csv !== "string") return null;
  const nums = csv.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(Number);
  if (nums.length === 0) return null;
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** [1,3,5] → "1,3,5". */
export function serializeWorkingWeekdays(nums: number[]): string {
  return [...new Set(nums)].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b).join(",");
}

/**
 * 명시 근무요일이 없을 때의 파생 — ★기존 computeRun 인라인 로직과 완전 동치(무회귀 앵커):
 *  월(1)~순으로 주휴일(weeklyHoliday) 제외하고 workDaysPerWeek개. 5일=월~금, 6일=월~토.
 *  순서 [1,2,3,4,5,6,0](월..토,일)에서 restDow 건너뛰고 wpw개.
 */
export function deriveWorkingWeekdays(
  workDaysPerWeek: number | null | undefined,
  weeklyHolidayLabel: string | null | undefined,
): number[] {
  const wpw = workDaysPerWeek ?? 5;
  const restDow = weeklyHolidayLabel ? (LABEL_TO_DOW[weeklyHolidayLabel] ?? 0) : 0;
  const out: number[] = [];
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    if (d === restDow) continue;
    out.push(d);
    if (out.length >= wpw) break;
  }
  return out;
}

/** 급여계산 단일 진입점: 명시(csv) 우선, 없으면 파생. 소정일수·MONTHLY 일할·주휴가 이 Set을 공유. */
export function resolveWorkingWeekdaySet(
  csv: string | null | undefined,
  workDaysPerWeek: number | null | undefined,
  weeklyHolidayLabel: string | null | undefined,
): Set<number> {
  return new Set(parseWorkingWeekdays(csv) ?? deriveWorkingWeekdays(workDaysPerWeek, weeklyHolidayLabel));
}

/** 명시 근무요일 CSV → 표기 라벨("1,3,5" → "월·수·금"). 미설정/형식오류 → null(호출부가 기존 문구 유지). */
export function workingWeekdaysLabel(csv: string | null | undefined): string | null {
  const nums = parseWorkingWeekdays(csv);
  return nums ? nums.map((d) => DOW_LABELS[d]).join("·") : null;
}

/** 계약 저장 시 검증 — 근무요일 집합의 정합성(0~6·비어있지 않음·주휴일 미포함·개수 정합). */
export function validateWorkingWeekdays(
  nums: number[],
  opts: { weeklyHolidayLabel?: string | null; workDaysPerWeek?: number | null } = {},
): { ok: true } | { ok: false; error: string } {
  if (!Array.isArray(nums) || nums.length === 0) return { ok: false, error: "근무요일을 1개 이상 선택해주세요." };
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 6)) return { ok: false, error: "요일 값이 올바르지 않습니다." };
  const set = new Set(nums);
  if (set.size !== nums.length) return { ok: false, error: "중복된 요일이 있습니다." };
  if (opts.weeklyHolidayLabel) {
    const restDow = LABEL_TO_DOW[opts.weeklyHolidayLabel];
    if (restDow != null && set.has(restDow)) return { ok: false, error: "주휴일은 근무요일에 포함될 수 없습니다." };
  }
  if (opts.workDaysPerWeek != null && set.size !== opts.workDaysPerWeek) {
    return { ok: false, error: `근무요일 수(${set.size})가 주 근무일수(${opts.workDaysPerWeek})와 일치해야 합니다.` };
  }
  return { ok: true };
}
