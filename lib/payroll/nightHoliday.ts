// lib/payroll/nightHoliday.ts
// 야간(22:00~06:00)·휴일 근로 '분' 집계 — computeRun에서 추출한 순수 로직(2026-07-16, 동작 불변 리팩터).
// 추출 목적: 노무사 판정 연계 가산 로직에 전용 회귀 테스트를 붙이기 위함(기존엔 computeRun 내장이라 미테스트).
//
// 의미(기존 semantics 그대로):
//  · 야간 = 근무구간 [startMin, nightEndMin) 과 야간창 [00:00,06:00)+[22:00,24:00) 겹침 분.
//    nightEndMin(실효 퇴근, 연장 포함)이 startMin 이하이면 미검출 — 자정 넘김은 검출하지 않는다(기존 정책).
//  · 휴일 = isHoliday(공휴일/주휴일) 행의 실근로분(고정 시각 span − 무급휴게)을 '날짜별 합산' 후
//    8h 경계 1회 판정: ≤8h 분은 0.5배 가산 대상, 초과분은 1.0배 가산 대상.
//    (행 단위 판정 금지 — 같은날 2배정(AM+PM) 합계가 8h를 넘어도 행별 8h 미만이면 과소지급되던 문제의 방어)
//  · 프리랜서(BUSINESS) 게이트·통상시급 곱은 호출부(computeRun) 책임 — 여기는 분 집계만.

export type NightHolidayRow = {
  workDate: string;       // "yyyy-mm-dd" (휴일 일별 합산 키)
  startMin: number;       // KST 분(0~1439) — 고정 출근시각
  endMin: number;         // KST 분 — 고정 퇴근시각(휴일 실근로 산정용)
  nightEndMin: number;    // 야간 검출용 실효 퇴근 분(연장 포함 — workEndMinutesForDay 결과)
  isHoliday: boolean;     // 공휴일 또는 주휴일 여부(판정은 호출부)
  unpaidBreakMin: number; // 무급휴게 분(휴일 실근로 = span − 이 값, 0 미만 클램프)
};

export type NightHolidayMinutes = {
  nightMin: number;       // 야간 가산(0.5배) 대상 분
  holidayLe8Min: number;  // 휴일 8h 이내(0.5배 가산) 분
  holidayGt8Min: number;  // 휴일 8h 초과(1.0배 가산) 분
};

const ovl = (s: number, e: number, a: number, b: number) => Math.max(0, Math.min(e, b) - Math.max(s, a));

export function computeNightHolidayMinutes(rows: NightHolidayRow[]): NightHolidayMinutes {
  let nightMin = 0;
  const holidayMinByDate = new Map<string, number>();
  for (const r of rows) {
    if (r.nightEndMin > r.startMin) {
      nightMin += ovl(r.startMin, r.nightEndMin, 0, 360) + ovl(r.startMin, r.nightEndMin, 1320, 1440);
    }
    if (r.isHoliday) {
      const span = Math.max(0, r.endMin - r.startMin);
      const workedMin = Math.max(0, span - r.unpaidBreakMin);
      holidayMinByDate.set(r.workDate, (holidayMinByDate.get(r.workDate) ?? 0) + workedMin);
    }
  }
  let holidayLe8Min = 0, holidayGt8Min = 0;
  for (const dayMin of holidayMinByDate.values()) {
    holidayLe8Min += Math.min(dayMin, 480);
    holidayGt8Min += Math.max(0, dayMin - 480);
  }
  return { nightMin, holidayLe8Min, holidayGt8Min };
}
