// 근무 미인정 휴무일(SiteHoliday.countAsWorkday=false)에 남아 있는 출근 행은 급여에서도 제외 (2026-10-08 감사 P2)
//  출근부는 이미 (배정, 날짜) 쌍으로 제외하고, MONTHLY 일할도 휴무일을 소정근로일에서 뺐다. 시급·일급제만 지급하던 불일치.
import { describe, it, expect, vi } from "vitest";
import { normalize, AGENCY, YEAR_MONTH } from "./helpers/payrollRunHarness";

const W = BigInt(9);
const SITE = BigInt(1);
const ASG = BigInt(1);

type Holiday = { date: string; assignmentId: bigint };

async function run(payType: string, base: number, holidays: Holiday[]) {
  vi.resetModules();
  const days = [2, 3, 4, 5, 6]; // 2026-11 월~금 첫 주
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      insuranceRates: { findFirst: async () => ({ year: 2026, nationalPension: 0.045, healthInsurance: 0.03545, longTermCare: 0.004591, employmentInsurance: 0.009, industrialAccident: 0.01, pensionBaseMin: null, pensionBaseMax: null }) },
      agency: { findUnique: async () => ({ lateThresholdMin: 30 }) },
      agencyDeduction: { findMany: async () => [] },
      incomeTaxTable: { findFirst: async () => ({ year: 2026, data: [], meta: {} }) },
      siteAssignment: { findMany: async () => [{ workerId: W, siteId: SITE, serviceStep: "FIELD_TRAINING", startDate: new Date("2026-01-01T00:00:00.000Z") }] },
      payContract: { findMany: async () => [{ workerId: W, siteId: null, baseAmount: base, hourlyRate2Plus: null, payType, incomeType: "EMPLOYMENT", weeklyHolidayPay: null }] },
      dailyAttendance: {
        findMany: async (args: { where: { workDate: { lt?: string } } }) =>
          args.where.workDate.lt ? [] : days.map((d) => ({
            workerId: W, assignmentId: ASG, workDate: `2026-11-0${d}`,
            startTime: new Date(Date.UTC(2026, 10, d, 0, 0)), endTime: new Date(Date.UTC(2026, 10, d, 9, 0)),
            actualStartTime: null, actualEndTime: null, payrollConfirmedAt: null,
            assignment: { siteId: SITE, workType: "FULL_DAY", commuteGuidanceIncluded: true, customWorkStart: null, customWorkEnd: null, attendanceButtonExempt: false, site: { lateThresholdMin: null } },
            logs: [],
          })),
      },
      traineePlacement: { findMany: async () => [{ siteId: SITE, startDate: new Date("2026-01-01T00:00:00.000Z"), endDate: null }] },
      employmentContract: { findMany: async () => [{ workerId: W, workDaysPerWeek: 5, weeklyHoliday: "일", workingWeekdays: null, contractStart: new Date("2026-01-01T00:00:00.000Z"), contractEnd: new Date("2026-12-31T00:00:00.000Z"), workStartTime: "09:00", workEndTime: "18:00", breakStartTime: "12:00", breakEndTime: "13:00" }] },
      siteHoliday: { findMany: async () => holidays.map((h) => ({ ...h, assignment: { workerId: W } })) },
      annualLeaveEntry: { findMany: async () => [] },
    },
  }));
  const { computePayrollItems } = await import("@/lib/payroll/computeRun");
  const { items } = await computePayrollItems(AGENCY, YEAR_MONTH);
  return normalize(items)[0] as { grossPay: string; workedDays: number };
}

const HOL: Holiday = { date: "2026-11-04", assignmentId: ASG };

describe("근무 미인정 휴무일의 출근 행은 급여에서 제외", () => {
  it("시급제: 휴무 등록일 하루가 근무일수·지급액에서 빠진다(8h × 10,030 = 80,240)", async () => {
    const without = await run("HOURLY", 10030, []);
    const withHol = await run("HOURLY", 10030, [HOL]);
    expect(withHol.workedDays).toBe(without.workedDays - 1);
    expect(Number(without.grossPay) - Number(withHol.grossPay)).toBe(80240);
  });

  it("일급제: 휴무 등록일 하루가 빠진다(80,000)", async () => {
    const without = await run("DAILY", 80000, []);
    const withHol = await run("DAILY", 80000, [HOL]);
    expect(withHol.workedDays).toBe(without.workedDays - 1);
    expect(Number(without.grossPay) - Number(withHol.grossPay)).toBe(80000);
  });

  it("다른 배정에 등록된 같은 날짜 휴무는 이 배정의 출근 행에 영향 없음", async () => {
    const without = await run("HOURLY", 10030, []);
    const other = await run("HOURLY", 10030, [{ date: "2026-11-04", assignmentId: BigInt(2) }]);
    expect(other.workedDays).toBe(without.workedDays);
    expect(other.grossPay).toBe(without.grossPay);
  });

  it("출근 행이 없는 날의 휴무 등록은 영향 없음", async () => {
    const without = await run("HOURLY", 10030, []);
    const other = await run("HOURLY", 10030, [{ date: "2026-11-10", assignmentId: ASG }]);
    expect(other.grossPay).toBe(without.grossPay);
  });
});
