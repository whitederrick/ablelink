// 계속근로 개월 달력 기준 — 2월 입사자 고용보험 3개월 판정 (2026-10-08)
import { describe, it, expect } from "vitest";
import { calendarMonthsElapsed, isUnderOneCalendarMonth, addMonthsClampUTC } from "@/lib/payroll/calendarMonths";
import { determineInsurances } from "@/lib/payroll/insuranceEligibility";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const THREE = (a: string, b: string) => calendarMonthsElapsed(d(a), d(b)) >= 3;

describe("calendarMonthsElapsed — 달력 3개월이 찬 날부터 3.0 이상", () => {
  it("2월이 낀 기간: 2/1 입사는 4/30에 3개월(종전 ÷30은 89일=2.97로 한 달 늦었음)", () => {
    expect(THREE("2027-02-01", "2027-04-30")).toBe(true);
    expect(THREE("2027-02-01", "2027-04-29")).toBe(false);
    // 윤년
    expect(THREE("2028-02-01", "2028-04-30")).toBe(true);
    expect(THREE("2028-02-01", "2028-04-29")).toBe(false);
  });

  it("2월이 없는 기간은 종전과 동일하게 3개월", () => {
    expect(THREE("2027-03-01", "2027-05-31")).toBe(true);
    expect(THREE("2027-03-01", "2027-05-30")).toBe(false);
    expect(THREE("2027-01-01", "2027-03-31")).toBe(true);
  });

  it("말일 입사: 1/31 입사는 (1/31+3개월=4/30) 4/29까지는 미달, 4/30에 3개월", () => {
    expect(THREE("2027-01-31", "2027-04-29")).toBe(false);
    expect(THREE("2027-01-31", "2027-04-30")).toBe(true);
  });

  it("종료가 시작보다 앞서면 0, 당일은 0 초과 1 미만", () => {
    expect(calendarMonthsElapsed(d("2027-03-10"), d("2027-03-09"))).toBe(0);
    const day1 = calendarMonthsElapsed(d("2027-03-10"), d("2027-03-10"));
    expect(day1).toBeGreaterThan(0);
    expect(day1).toBeLessThan(1);
  });

  it("월 경계에서 단조 증가", () => {
    let prev = -1;
    for (let day = 0; day < 200; day++) {
      const end = new Date(d("2027-02-01").getTime() + day * 86400000);
      const v = calendarMonthsElapsed(d("2027-02-01"), end);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("1개월 미만(일용) 판정과 같은 기준", () => {
  it("2월 한 달(2/1~2/28)은 1개월 이상, 하루 모자라면 미만", () => {
    expect(isUnderOneCalendarMonth(d("2027-02-01"), d("2027-02-28"))).toBe(false);
    expect(isUnderOneCalendarMonth(d("2027-02-01"), d("2027-02-27"))).toBe(true);
    expect(addMonthsClampUTC(d("2027-01-31"), 1).toISOString().slice(0, 10)).toBe("2027-02-28");
  });
});

describe("고용보험 판정에 반영", () => {
  const base = { employmentMonths: 12, monthlyHours: 40, monthlyDays: 5 }; // 월 60시간 미만 초단시간
  it("계속근로 3개월 이상이면 초단시간이어도 고용보험 공제", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, continuousMonths: calendarMonthsElapsed(d("2027-02-01"), d("2027-04-30")) });
    expect(r.workerDeductible).toContain("employment");
  });
  it("3개월 미만이면 공제하지 않음", () => {
    const r = determineInsurances("EMPLOYMENT", { ...base, continuousMonths: calendarMonthsElapsed(d("2027-02-01"), d("2027-04-29")) });
    expect(r.workerDeductible).not.toContain("employment");
  });
});
