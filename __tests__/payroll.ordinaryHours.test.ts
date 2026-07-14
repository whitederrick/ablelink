import { describe, it, expect } from "vitest";
import { monthlyStandardHours } from "@/lib/payroll/ordinaryHours";

describe("monthlyStandardHours — 월 소정근로시간(통상시급 분모)", () => {
  it("주40h(전일 5일) → 209 (관행값 정확 일치·무회귀 앵커)", () => {
    expect(monthlyStandardHours(40)).toBe(209);
  });
  it("주20h(단시간) → 104 (노무사 예시 (20+4)×4.345≈104.28)", () => {
    expect(monthlyStandardHours(20)).toBe(104);
  });
  it("주16.5h(오전/오후 3일) → 86", () => {
    // (16.5 + 16.5/40*8) × 4.345 = (16.5+3.3)×4.345 = 86.03 → 86
    expect(monthlyStandardHours(16.5)).toBe(86);
  });
  it("주30h → 156", () => {
    // (30 + 6) × 4.345 = 156.42 → 156
    expect(monthlyStandardHours(30)).toBe(156);
  });
  it("주48h(법정 40h 상한 적용) → 209 (초과분은 소정 아님)", () => {
    expect(monthlyStandardHours(48)).toBe(209);
  });
  it("0 또는 음수 방어 → 0", () => {
    expect(monthlyStandardHours(0)).toBe(0);
    expect(monthlyStandardHours(-5)).toBe(0);
  });
  it("단시간일수록 분모가 작아 통상시급이 커진다(가산 과소지급 해소)", () => {
    // 같은 월급이라도 주20h 분모(104)가 주40h 분모(209)보다 작아 통상시급이 약 2배
    const monthly = 2_000_000;
    const wageFull = monthly / monthlyStandardHours(40);
    const wageHalf = monthly / monthlyStandardHours(20);
    expect(wageHalf).toBeGreaterThan(wageFull);
  });
});
