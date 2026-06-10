import { describe, it, expect } from "vitest";
import { computeWeeklyHoliday, isoWeekKey, scheduledMinutesForWorkType } from "@/lib/payroll/weeklyHoliday";

// 2026년 6월: 1일(월). 주차 — W23: 6/1~6/7, W24: 6/8~6/14, W25: 6/15~6/21, W26: 6/22~6/28, W27: 6/29~7/5
const mon = (d: number) => `2026-06-${String(d).padStart(2, "0")}`;

function fullWeek(days: number[], min = 240) {
  return days.map(d => ({ dateISO: mon(d), scheduledMinutes: min }));
}

describe("isoWeekKey", () => {
  it("2026-06-08(월)·06-14(일) 같은 주 W24", () => {
    expect(isoWeekKey("2026-06-08")).toBe("2026-W24");
    expect(isoWeekKey("2026-06-14")).toBe("2026-W24");
  });
  it("2026-06-15(월)은 W25", () => {
    expect(isoWeekKey("2026-06-15")).toBe("2026-W25");
  });
});

describe("scheduledMinutesForWorkType — 휴게·출퇴근지도 제외 실근로", () => {
  it("AM/PM=240, FULL_DAY=480", () => {
    expect(scheduledMinutesForWorkType("AM")).toBe(240);
    expect(scheduledMinutesForWorkType("PM")).toBe(240);
    expect(scheduledMinutesForWorkType("FULL_DAY")).toBe(480);
  });
  it("CUSTOM 4h↑은 휴게30 제외", () => {
    expect(scheduledMinutesForWorkType("CUSTOM", "09:00", "13:00")).toBe(210); // 4h-30
    expect(scheduledMinutesForWorkType("CUSTOM", "09:00", "12:00")).toBe(180); // 3h 그대로
  });
});

describe("computeWeeklyHoliday — 2조건 판정", () => {
  it("주5일 개근 + 4주평균 20h(주240×5=1200분) → 매주 적격, 자동 산식", () => {
    // 4주 모두 월~금 5일 × 4h = 20h/주
    const days = [
      ...fullWeek([8, 9, 10, 11, 12]),   // W24
      ...fullWeek([15, 16, 17, 18, 19]), // W25
      ...fullWeek([22, 23, 24, 25, 26]), // W26
      ...fullWeek([1, 2, 3, 4, 5]),      // W23+W27 혼합이지만 별개 주
    ];
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 12000 });
    expect(r.meets15h).toBe(true);
    // 주휴수당 = 20h÷40×8×12000 = 0.5×8×12000 = 48,000원/주
    const eligibleWeek = r.weeks.find(w => w.eligible);
    expect(eligibleWeek?.holidayPay).toBe(48000);
    expect(r.eligibleWeeks).toBe(r.weeks.length);
  });

  it("한 주 결근(4일만) → 그 주 미개근, 주휴 미발생", () => {
    const days = [
      ...fullWeek([8, 9, 10, 11]),       // W24: 4일만 (개근 X)
      ...fullWeek([15, 16, 17, 18, 19]), // W25: 5일 개근
    ];
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 12000 });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    const w25 = r.weeks.find(w => w.weekKey === "2026-W25")!;
    expect(w24.fullAttendance).toBe(false);
    expect(w24.eligible).toBe(false);
    expect(w25.eligible).toBe(true);
  });

  it("4주평균 15h 미만(주3일×4h=12h) → 전체 미발생", () => {
    const days = [
      ...fullWeek([8, 9, 10]),    // 12h
      ...fullWeek([15, 16, 17]),  // 12h
    ];
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 3, ordinaryWage: 12000 });
    expect(r.meets15h).toBe(false);
    expect(r.eligibleWeeks).toBe(0);
    expect(r.totalHolidayPay).toBe(0);
  });

  it("flatWeeklyHolidayPay 오버라이드", () => {
    const days = fullWeek([8, 9, 10, 11, 12]); // 20h, 개근
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 12000, flatWeeklyHolidayPay: 50000 });
    expect(r.weeks[0].eligible).toBe(true);
    expect(r.weeks[0].holidayPay).toBe(50000);
    expect(r.totalHolidayPay).toBe(50000);
  });

  it("정확히 15h(주5일×3h)면 적격", () => {
    const days = fullWeek([8, 9, 10, 11, 12], 180); // 3h×5=15h
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 10000 });
    expect(r.meets15h).toBe(true);
    // 15÷40×8×10000 = 30,000원
    expect(r.weeks[0].holidayPay).toBe(30000);
  });
});
