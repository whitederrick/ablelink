import { describe, it, expect } from "vitest";
import { standardMonthlyIncome } from "@/lib/payroll/pensionBase";

describe("standardMonthlyIncome — 국민연금 기준소득월액", () => {
  it("하한/상한 모두 미설정이면 null(종전 근사 유지)", () => {
    expect(standardMonthlyIncome(550000, null, null)).toBeNull();
    expect(standardMonthlyIncome(550000, 0, 0)).toBeNull();
  });

  it("1,000원 미만 절사", () => {
    expect(standardMonthlyIncome(550555, 400000, 6370000)).toBe(550000);
    expect(standardMonthlyIncome(550999, 400000, 6370000)).toBe(550000);
  });

  it("하한 미달자는 하한액으로(과소공제 방지)", () => {
    expect(standardMonthlyIncome(350000, 400000, 6370000)).toBe(400000);
    expect(standardMonthlyIncome(0, 400000, 6370000)).toBe(400000);
  });

  it("상한 초과자는 상한액으로", () => {
    expect(standardMonthlyIncome(7000000, 400000, 6370000)).toBe(6370000);
  });

  it("정상 범위는 절사값 그대로", () => {
    expect(standardMonthlyIncome(1200000, 400000, 6370000)).toBe(1200000);
  });

  it("하한만 설정(상한 null)도 동작", () => {
    expect(standardMonthlyIncome(300000, 400000, null)).toBe(400000);
    expect(standardMonthlyIncome(900000, 400000, null)).toBe(900000);
  });

  it("파트타임 오전 4시간(예: 월 55만) — 하한 이상이라 그대로", () => {
    expect(standardMonthlyIncome(550000, 400000, 6370000)).toBe(550000);
  });
});
