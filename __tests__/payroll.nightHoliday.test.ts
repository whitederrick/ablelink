// 야간(22~06)·휴일 가산 분 집계 회귀 테스트 — lib/payroll/nightHoliday.ts
// (2026-07-16 computeRun에서 추출. 노무사 연계 가산 로직의 전용 테스트 부재를 해소.)
import { describe, it, expect } from "vitest";
import { computeNightHolidayMinutes, type NightHolidayRow } from "@/lib/payroll/nightHoliday";

const row = (over: Partial<NightHolidayRow>): NightHolidayRow => ({
  workDate: "2026-07-06", startMin: 540, endMin: 1080, nightEndMin: 1080,
  isHoliday: false, unpaidBreakMin: 0, ...over,
});

describe("야간 근로 분 검출", () => {
  it("주간 근무(09~18시)는 야간 0", () => {
    const r = computeNightHolidayMinutes([row({})]);
    expect(r.nightMin).toBe(0);
  });

  it("22시 이후 겹침: 실효퇴근 23:30이면 90분", () => {
    // 연장으로 nightEndMin(실효 퇴근)만 늘어난 경우 — 야간창 [22:00,24:00)와 겹침
    const r = computeNightHolidayMinutes([row({ nightEndMin: 23 * 60 + 30 })]);
    expect(r.nightMin).toBe(90);
  });

  it("새벽(06시 이전) 겹침: 05:00 출근이면 60분", () => {
    const r = computeNightHolidayMinutes([row({ startMin: 300, endMin: 600, nightEndMin: 600 })]);
    expect(r.nightMin).toBe(60);
  });

  it("자정 넘김(실효퇴근 ≤ 출근 분)은 미검출 — 기존 정책 유지", () => {
    // 21:00 출근, 익일 01:00 퇴근이 KST 분 wrap으로 60이 되는 경우: nightEndMin(60) ≤ startMin(1260) → 0
    const r = computeNightHolidayMinutes([row({ startMin: 1260, endMin: 60, nightEndMin: 60 })]);
    expect(r.nightMin).toBe(0);
  });

  it("22~06시 창을 양쪽 모두 걸치는 하루 두 행 합산", () => {
    const r = computeNightHolidayMinutes([
      row({ startMin: 300, endMin: 540, nightEndMin: 540 }),          // 05:00~09:00 → 새벽 60
      row({ startMin: 1200, endMin: 1380, nightEndMin: 1380 }),       // 20:00~23:00 → 야간 60
    ]);
    expect(r.nightMin).toBe(120);
  });
});

describe("휴일 근로 8h 경계(일별 합산)", () => {
  it("휴일 아닌 행은 휴일 분 0", () => {
    const r = computeNightHolidayMinutes([row({})]);
    expect(r.holidayLe8Min).toBe(0);
    expect(r.holidayGt8Min).toBe(0);
  });

  it("휴일 9시간(무급휴게 60분 제외 전 10h span): 8h 이내 480 + 초과 60", () => {
    // span 600 − 휴게 60 = 540분 실근로
    const r = computeNightHolidayMinutes([row({ isHoliday: true, startMin: 540, endMin: 1140, unpaidBreakMin: 60 })]);
    expect(r.holidayLe8Min).toBe(480);
    expect(r.holidayGt8Min).toBe(60);
  });

  it("★같은날 2배정(5h+4h)은 일별 합산 후 경계 판정 — 행 단위면 과소지급되던 케이스", () => {
    const r = computeNightHolidayMinutes([
      row({ isHoliday: true, startMin: 480, endMin: 780 }),   // 5h
      row({ isHoliday: true, startMin: 800, endMin: 1040 }),  // 4h
    ]);
    // 합계 9h → 480 + 60 (행 단위 판정이면 gt8=0으로 초과 60분이 0.5배 과소지급)
    expect(r.holidayLe8Min).toBe(480);
    expect(r.holidayGt8Min).toBe(60);
  });

  it("다른 날짜의 휴일 근무는 각자 경계 판정", () => {
    const r = computeNightHolidayMinutes([
      row({ isHoliday: true, workDate: "2026-07-05", startMin: 540, endMin: 1140 }), // 10h
      row({ isHoliday: true, workDate: "2026-07-12", startMin: 540, endMin: 780 }),  // 4h
    ]);
    expect(r.holidayLe8Min).toBe(480 + 240);
    expect(r.holidayGt8Min).toBe(120);
  });

  it("무급휴게가 span보다 커도 음수 없이 0 클램프", () => {
    const r = computeNightHolidayMinutes([row({ isHoliday: true, startMin: 600, endMin: 630, unpaidBreakMin: 60 })]);
    expect(r.holidayLe8Min).toBe(0);
    expect(r.holidayGt8Min).toBe(0);
  });

  it("빈 입력은 전부 0", () => {
    const r = computeNightHolidayMinutes([]);
    expect(r).toEqual({ nightMin: 0, holidayLe8Min: 0, holidayGt8Min: 0, holidayOtGt8Min: 0 });
  });
});

describe("휴일 '연장'분 8h 초과 보충 가산(holidayOtGt8Min)", () => {
  // 연장은 기본급 미포함·연장수당 1.5배 별도 지급 → 8h 초과분만 0.5배 보충해 계 2.0배(법정).
  it("★전일 8h(고정) + 연장 2h: 연장 120분 전부가 8h 초과 → 보충 대상 120", () => {
    // 09~18시 span 540 − 휴게 60 = 고정 480분. 기존 버킷은 불변(회귀 방지).
    const r = computeNightHolidayMinutes([
      row({ isHoliday: true, startMin: 540, endMin: 1080, unpaidBreakMin: 60, overtimeMin: 120 }),
    ]);
    expect(r.holidayLe8Min).toBe(480);
    expect(r.holidayGt8Min).toBe(0);
    expect(r.holidayOtGt8Min).toBe(120);
  });

  it("오후 5.5h + 연장 2h = 7.5h ≤ 8h: 보충 0 (연장 1.5배 = 법정 휴일 1.5배 동액)", () => {
    const r = computeNightHolidayMinutes([
      row({ isHoliday: true, startMin: 780, endMin: 1110, overtimeMin: 120 }), // 13:00~18:30 = 330분
    ]);
    expect(r.holidayLe8Min).toBe(330);
    expect(r.holidayOtGt8Min).toBe(0);
  });

  it("고정 5.5h + 연장 4h = 9.5h: 연장 중 8h 경계 넘는 90분만 보충", () => {
    const r = computeNightHolidayMinutes([
      row({ isHoliday: true, startMin: 780, endMin: 1110, overtimeMin: 240 }), // 고정 330 + 연장 240 = 570
    ]);
    expect(r.holidayLe8Min).toBe(330);
    expect(r.holidayGt8Min).toBe(0);
    expect(r.holidayOtGt8Min).toBe(90);
  });

  it("같은날 2배정(AM 5.5h+PM 5.5h=11h 고정) + 연장 1h: 고정 초과 180은 기존 버킷, 연장 60은 보충 버킷", () => {
    const r = computeNightHolidayMinutes([
      row({ isHoliday: true, startMin: 480, endMin: 810 }),                    // 330분
      row({ isHoliday: true, startMin: 820, endMin: 1150, overtimeMin: 60 }),  // 330분 + 연장 60
    ]);
    expect(r.holidayLe8Min).toBe(480);
    expect(r.holidayGt8Min).toBe(180);   // 고정 660 − 480 (기본급 포함이라 가산 1.0로 충족)
    expect(r.holidayOtGt8Min).toBe(60);  // 연장분은 전부 8h 밖 → 0.5배 보충
  });

  it("휴일 아닌 행의 연장은 보충 무관(0)", () => {
    const r = computeNightHolidayMinutes([row({ overtimeMin: 240 })]);
    expect(r.holidayOtGt8Min).toBe(0);
  });
});
