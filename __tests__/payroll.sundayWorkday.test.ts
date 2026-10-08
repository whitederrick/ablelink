// 소정근로 요일에 일요일이 포함된 계약 — 일요일 근무가 휴일근로 가산(+0.5배)으로 잡히면 안 된다 (2026-10-08 감사 P2).
//  + 원 단위 절사(floorWon) 부동소수점 오차 회귀.
import { describe, it, expect, vi } from "vitest";
import { floorWon } from "@/lib/payroll/floorWon";
import { normalize, AGENCY, YEAR_MONTH } from "./helpers/payrollRunHarness";

const W = BigInt(9);
const SITE = BigInt(1);

async function run(contract: { weeklyHoliday: string | null; workingWeekdays: string | null; workDaysPerWeek: number }) {
  vi.resetModules();
  // 2026-11-01(일) 하루만 근무하는 시급제 워커 하나로 모의 DB 덮어쓰기.
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      insuranceRates: { findFirst: async () => ({ year: 2026, nationalPension: 0.045, healthInsurance: 0.03545, longTermCare: 0.004591, employmentInsurance: 0.009, industrialAccident: 0.01, pensionBaseMin: null, pensionBaseMax: null }) },
      agency: { findUnique: async () => ({ lateThresholdMin: 30 }) },
      agencyDeduction: { findMany: async () => [] },
      incomeTaxTable: { findFirst: async () => ({ year: 2026, data: [], meta: {} }) },
      siteAssignment: { findMany: async () => [{ workerId: W, siteId: SITE, serviceStep: "FIELD_TRAINING", startDate: new Date("2026-01-01T00:00:00.000Z") }] },
      payContract: { findMany: async () => [{ workerId: W, siteId: null, baseAmount: 10030, hourlyRate2Plus: null, payType: "HOURLY", incomeType: "EMPLOYMENT", weeklyHolidayPay: null }] },
      dailyAttendance: {
        findMany: async (args: { where: { workDate: { lt?: string } } }) =>
          args.where.workDate.lt ? [] : [{
            workerId: W, workDate: "2026-11-01",
            startTime: new Date(Date.UTC(2026, 10, 1, 0, 0)), endTime: new Date(Date.UTC(2026, 10, 1, 9, 0)),
            actualStartTime: null, actualEndTime: null, payrollConfirmedAt: null,
            assignment: { siteId: SITE, workType: "FULL_DAY", commuteGuidanceIncluded: true, customWorkStart: null, customWorkEnd: null, attendanceButtonExempt: false, site: { lateThresholdMin: null } },
            logs: [],
          }],
      },
      traineePlacement: { findMany: async () => [{ siteId: SITE, startDate: new Date("2026-01-01T00:00:00.000Z"), endDate: null }] },
      employmentContract: {
        findMany: async () => [{
          workerId: W, ...contract,
          contractStart: new Date("2026-01-01T00:00:00.000Z"), contractEnd: new Date("2026-12-31T00:00:00.000Z"),
          workStartTime: "09:00", workEndTime: "18:00", breakStartTime: "12:00", breakEndTime: "13:00",
        }],
      },
      siteHoliday: { findMany: async () => [] },
      annualLeaveEntry: { findMany: async () => [] },
    },
  }));
  const { computePayrollItems } = await import("@/lib/payroll/computeRun");
  const { items } = await computePayrollItems(AGENCY, YEAR_MONTH);
  return normalize(items)[0] as { breakdown: Record<string, unknown> };
}

describe("일요일 근무 — 휴일근로 가산 판정", () => {
  it("근무요일에 일요일 포함 + weeklyHoliday 비어 있음 → 휴일근로 가산 없음", async () => {
    const r = await run({ weeklyHoliday: null, workingWeekdays: "0,1,2,3,4,5", workDaysPerWeek: 6 });
    expect(r.breakdown.holidayPay).toBeUndefined();
  });

  it("주휴일이 일요일이고 근무요일이 월~금 → 일요일 근무는 기존대로 휴일근로 가산", async () => {
    const r = await run({ weeklyHoliday: "일", workingWeekdays: null, workDaysPerWeek: 5 });
    expect(r.breakdown.holidayPay).toBeGreaterThan(0);
  });
});

describe("floorWon — 원 단위 절사", () => {
  it("정확히 떨어지는 값이 float 오차로 1원 모자라지 않는다", () => {
    expect(Math.floor(3000 * 0.009)).toBe(26); // 내림 전 오차(기존 버그)를 재현
    expect(floorWon(3000 * 0.009)).toBe(27);
  });

  it("실제 소수부는 그대로 절사한다", () => {
    expect(floorWon(100 * 0.0099)).toBe(0);
    expect(floorWon(1999999 * 0.009)).toBe(17999); // 17999.991
    expect(floorWon(2090000 * 0.03545)).toBe(74090); // 74090.5 → 버림
  });

  it("고용보험 0.9% 요율: 1,000원 단위 전 구간에서 정수 곱셈 결과와 일치", () => {
    for (let g = 1000; g <= 5000000; g += 1000) {
      expect(floorWon(g * 0.009)).toBe(Math.floor((g * 9) / 1000));
    }
  });
});
