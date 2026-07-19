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
  overtimeMin?: number;   // 이 행의 유급 연장 분(overtimeMinutesForDay 결과) — 휴일행만 의미(holidayOtGt8Min 산정용)
};

export type NightHolidayMinutes = {
  nightMin: number;       // 야간 가산(0.5배) 대상 분
  holidayLe8Min: number;  // 휴일 8h 이내(0.5배 가산) 분
  holidayGt8Min: number;  // 휴일 8h 초과(1.0배 가산) 분 — 고정 span 내 초과분(기본급에 이미 포함 → 가산 1.0으로 계 2.0)
  // 휴일 '연장'분 중 8h 초과분. 연장은 기본급 미포함·연장수당 1.5배로 별도 지급되므로,
  //  법정 2.0배(휴일 8h 초과)를 맞추려면 이 분에 0.5배 '보충 가산'이 필요하다(1.5+0.5=2.0).
  //  8h 이내에 머무는 휴일 연장은 연장 1.5배 = 법정 휴일 1.5배로 동액이라 보충 불요.
  holidayOtGt8Min: number;
};

const ovl = (s: number, e: number, a: number, b: number) => Math.max(0, Math.min(e, b) - Math.max(s, a));

export function computeNightHolidayMinutes(rows: NightHolidayRow[]): NightHolidayMinutes {
  let nightMin = 0;
  const holidayMinByDate = new Map<string, number>();
  const holidayOtMinByDate = new Map<string, number>();
  for (const r of rows) {
    if (r.nightEndMin > r.startMin) {
      nightMin += ovl(r.startMin, r.nightEndMin, 0, 360) + ovl(r.startMin, r.nightEndMin, 1320, 1440);
    }
    if (r.isHoliday) {
      const span = Math.max(0, r.endMin - r.startMin);
      const workedMin = Math.max(0, span - r.unpaidBreakMin);
      holidayMinByDate.set(r.workDate, (holidayMinByDate.get(r.workDate) ?? 0) + workedMin);
      const ot = Math.max(0, r.overtimeMin ?? 0);
      if (ot > 0) holidayOtMinByDate.set(r.workDate, (holidayOtMinByDate.get(r.workDate) ?? 0) + ot);
    }
  }
  let holidayLe8Min = 0, holidayGt8Min = 0, holidayOtGt8Min = 0;
  for (const [date, dayMin] of holidayMinByDate) {
    holidayLe8Min += Math.min(dayMin, 480);
    holidayGt8Min += Math.max(0, dayMin - 480);
    // 연장은 고정 근무 뒤에 붙으므로, 연장분 중 8h 경계를 넘는 부분 = (고정+연장) − max(480, 고정).
    const otMin = holidayOtMinByDate.get(date) ?? 0;
    if (otMin > 0) holidayOtGt8Min += Math.max(0, dayMin + otMin - Math.max(480, dayMin));
  }
  return { nightMin, holidayLe8Min, holidayGt8Min, holidayOtGt8Min };
}
