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

// ★17차: 주휴수당 1일분은 법정 상한 8h. 주 소정이 40h를 넘어도 (주소정÷40)×8이 8h를 못 넘게 클램프.
describe("computeWeeklyHoliday — 주휴 1일분 8h 상한(주40h 초과 클램프)", () => {
  it("주6일×8h=48h 개근 → 주휴는 8h분(9.6h 아님)으로 상한", () => {
    // wpw=6 → 소정근로일 월~토. W24: 6/8(월)~6/13(토) 6일 × 480분(8h) 개근.
    const days = [8, 9, 10, 11, 12, 13].map(d => ({ dateISO: mon(d), scheduledMinutes: 480 }));
    // 소정요일 월~토(계약 파생 authoritative) — computeRun이 넘기는 값과 동일.
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 6, ordinaryWage: 10000, workingWeekdays: new Set([1, 2, 3, 4, 5, 6]) });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.fullAttendance).toBe(true);
    expect(w24.eligible).toBe(true);
    // 상한 적용: 8h × 10,000 = 80,000원 (미적용 시 48÷40×8×10000 = 96,000원이 됐을 것)
    expect(w24.holidayPay).toBe(80000);
  });
  it("주5일×8h=40h(정확히 상한) → 8h분 그대로", () => {
    const days = [8, 9, 10, 11, 12].map(d => ({ dateISO: mon(d), scheduledMinutes: 480 }));
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 10000 });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.holidayPay).toBe(80000); // 40÷40×8×10000
  });
});

// ★노무사 #4: 같은 날 여러 배정(AM+PM 다른 현장)은 하루 소정으로 합산 후 평균 — 1주 총 소정 기준.
describe("computeWeeklyHoliday — 같은 날 2배정 소정 합산(#4)", () => {
  it("AM+PM 같은 날 2행(240+240)은 하루 480으로 합산 → 주휴 8h분(행별 평균의 절반 아님)", () => {
    const days: { dateISO: string; scheduledMinutes: number }[] = [];
    for (const d of [8, 9, 10, 11, 12]) {
      days.push({ dateISO: mon(d), scheduledMinutes: 240 }); // AM
      days.push({ dateISO: mon(d), scheduledMinutes: 240 }); // PM(같은 날 다른 배정)
    }
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 10000 });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.workedDays).toBe(5);   // 달력일 기준 5일(중복 카운트 아님)
    expect(w24.eligible).toBe(true);
    // 합산 1주 소정 = 480×5 = 2400분(40h) → 주휴 8h × 10,000 = 80,000원.
    //  (버그였다면 행별 평균 240×5=1200분(20h) → 40,000원으로 절반 과소지급)
    expect(w24.holidayPay).toBe(80000);
  });

  it("단일 배정(1행/일)은 종전과 동일(무회귀)", () => {
    const days = [8, 9, 10, 11, 12].map(d => ({ dateISO: mon(d), scheduledMinutes: 240 }));
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 12000 });
    expect(r.weeks[0].holidayPay).toBe(48000); // 20h÷40×8×12000
  });
});

describe("computeWeeklyHoliday — payMonth 전월 lookback 오염 방지(#3)", () => {
  // 전월 말(6월 W26, FULL_DAY 480분) lookback + 7월(W28, AM 330분) 개근.
  // payMonth=2026-07 → 6월 480분이 7월 평균/주휴액에 섞이면 안 됨(월경계 근무형태 변경).
  const jul = (d: number) => `2026-07-${String(d).padStart(2, "0")}`;
  const days = [
    { dateISO: "2026-06-22", scheduledMinutes: 480 }, // W26(6/22~6/28, 6월귀속) — 제외돼야
    { dateISO: "2026-06-23", scheduledMinutes: 480 },
    { dateISO: "2026-06-24", scheduledMinutes: 480 },
    { dateISO: "2026-06-25", scheduledMinutes: 480 },
    { dateISO: "2026-06-26", scheduledMinutes: 480 },
    ...[6, 7, 8, 9, 10].map((d) => ({ dateISO: jul(d), scheduledMinutes: 330 })), // W28(7/6~7/12, 7월) 개근
  ];

  it("7월 주휴액은 7월 소정시간(330분)만 반영 — 6월 480분에 오염 안 됨", () => {
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 10000, payMonth: "2026-07" });
    // 7월 귀속 주(W28)만 지급 대상
    const paid = r.weeks.filter((w) => w.eligible);
    expect(paid.length).toBe(1);
    // 깨끗한 값: 27.5h÷40×8×10000 = 55,000원 (오염 시 405분→67,500원이 됐을 것)
    expect(paid[0].holidayPay).toBe(55000);
  });
});

describe("computeWeeklyHoliday — 무출근/결근주 명시(periodStart/End)", () => {
  it("periodStart/End 주면 출근 0인 주도 부적격 주로 남는다(사라지지 않음)", () => {
    // 6월 전체 기간인데 W24만 출근 → 나머지 주(W23·W25·W26·W27)는 무출근 주로 부적격 명시.
    const days = fullWeek([8, 9, 10, 11, 12]); // W24만 개근
    const r = computeWeeklyHoliday({
      days, workDaysPerWeek: 5, ordinaryWage: 12000,
      periodStart: "2026-06-01", periodEnd: "2026-06-30",
    });
    // 6월을 걸치는 모든 주가 목록에 존재
    expect(r.weeks.length).toBeGreaterThanOrEqual(5);
    const empty = r.weeks.filter(w => w.workedDays === 0);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every(w => !w.eligible && w.holidayPay === 0)).toBe(true);
    // 결근주가 명시돼도 실제 지급액은 출근한 적격주(W24)만 반영 — 금액 왜곡 없음.
    expect(r.eligibleWeeks).toBe(1);
    expect(r.totalHolidayPay).toBe(48000);
  });

  it("periodStart/End 없으면 종전대로 출근한 주만 집계(하위호환)", () => {
    const days = fullWeek([8, 9, 10, 11, 12]);
    const r = computeWeeklyHoliday({ days, workDaysPerWeek: 5, ordinaryWage: 12000 });
    expect(r.weeks.length).toBe(1);
    expect(r.weeks[0].weekKey).toBe("2026-W24");
  });
});

describe("computeWeeklyHoliday — 공휴일 낀 주 개근 인정", () => {
  it("공휴일(6/10 수)에 안 나왔어도 나머지 소정근로일(4일) 개근이면 주휴 지급", () => {
    // W24: 월~금 중 6/10(수)이 공휴일 → 소정근로일 4일. 6/8,9,11,12 출근(4일) = 개근.
    const days = fullWeek([8, 9, 11, 12]); // 4일 (6/10 제외)
    const r = computeWeeklyHoliday({
      days, workDaysPerWeek: 5, ordinaryWage: 12000,
      holidaySet: new Set(["2026-06-10"]),
    });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.fullAttendance).toBe(true);
    expect(w24.eligible).toBe(true);
    // 주휴액은 통상 1주(평균 1일 소정 240 × 5일 = 1200분=20h) 기준 → 48,000원(공휴일로 줄지 않음)
    expect(w24.holidayPay).toBe(48000);
  });

  it("주말 공휴일은 소정근로일에 무영향(개근 기준 그대로 5일)", () => {
    const days = fullWeek([8, 9, 10, 11]); // 4일만
    const r = computeWeeklyHoliday({
      days, workDaysPerWeek: 5, ordinaryWage: 12000,
      holidaySet: new Set(["2026-06-13"]), // 토요일 → 소정근로일 아님
    });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.fullAttendance).toBe(false); // 4일 < 소정 5일
    expect(w24.eligible).toBe(false);
  });

  it("커스텀휴무도 공휴일과 동일하게 소정근로일에서 제외", () => {
    const days = fullWeek([8, 9, 10, 12]); // 6/11(목) 커스텀휴무로 안 나옴, 4일 출근
    const r = computeWeeklyHoliday({
      days, workDaysPerWeek: 5, ordinaryWage: 12000,
      holidaySet: new Set(["2026-06-11"]),
    });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.eligible).toBe(true);
  });
});

// ★14차: 개근(조건①)은 '소정근로일' 출근만 카운트. 비소정일(주말)·공휴일 출근이 소정일 결근을 상쇄하면 안 됨.
describe("computeWeeklyHoliday — 소정근로일만 개근 카운트(비소정일/공휴일 출근 상쇄 방지)", () => {
  const base = { workDaysPerWeek: 5, ordinaryWage: 12000 } as const;
  it("월~금 워커가 수요일 결근 + 토요일 출근 → 개근 아님(비적격)", () => {
    // W24: Mon8,Tue9 출근, Wed10 결근, Thu11,Fri12 출근, Sat13(비소정) 출근
    const days = [8, 9, 11, 12, 13].map(d => ({ dateISO: mon(d), scheduledMinutes: 240 }));
    const r = computeWeeklyHoliday({ ...base, days });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.workedDays).toBe(4);      // 토요일 제외
    expect(w24.fullAttendance).toBe(false);
    expect(w24.eligible).toBe(false);
  });
  it("월~금 정상 출근 → 개근(적격)", () => {
    const days = [8, 9, 10, 11, 12].map(d => ({ dateISO: mon(d), scheduledMinutes: 240 }));
    const r = computeWeeklyHoliday({ ...base, days });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.workedDays).toBe(5);
    expect(w24.eligible).toBe(true);
  });
  it("수요일 공휴일: 목요일 결근 + 공휴일(수) 출근 → 개근 아님(공휴일 출근 상쇄 방지)", () => {
    // requiredDays = 5 - 1(수 공휴일) = 4. Mon8,Tue9,Fri12 출근 + Wed10(공휴일) 출근, Thu11 결근
    const days = [8, 9, 10, 12].map(d => ({ dateISO: mon(d), scheduledMinutes: 240 }));
    const r = computeWeeklyHoliday({ ...base, days, holidaySet: new Set(["2026-06-10"]) });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.workedDays).toBe(3);      // 공휴일(수) 제외 → 8,9,12
    expect(w24.eligible).toBe(false);
  });
  it("수요일 공휴일: 나머지 소정일(월화목금) 개근 → 적격", () => {
    const days = [8, 9, 11, 12].map(d => ({ dateISO: mon(d), scheduledMinutes: 240 }));
    const r = computeWeeklyHoliday({ ...base, days, holidaySet: new Set(["2026-06-10"]) });
    const w24 = r.weeks.find(w => w.weekKey === "2026-W24")!;
    expect(w24.workedDays).toBe(4);
    expect(w24.eligible).toBe(true);
  });
});
