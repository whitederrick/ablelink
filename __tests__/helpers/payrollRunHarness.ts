// computePayrollItems 통합 테스트용 모의 DB 하네스(2026-11, 공휴일 없는 달).
//  prisma 쿼리는 where를 해석하지 않고 고정 fixture를 돌려준다 — computeRun이 워커별로 직접 그룹핑하기 때문.
//  워커: 1=월급제(11/11·11/12 결근) 2=시급제(11/11 결근) 3=일급제(11/11 결근) 4=월급제(11/4 결근, 연차 기록 없음)

import { vi } from "vitest";

export const YEAR_MONTH = "2026-11";
export const AGENCY = BigInt(1);
const SITE = BigInt(1);

// 2026-11 평일(공휴일 없음): 2~6, 9~13, 16~20, 23~27, 30  → 소정근로일 21일
export const WEEKDAYS = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 23, 24, 25, 26, 27, 30];
export const iso = (d: number) => `2026-11-${String(d).padStart(2, "0")}`;

type Row = Record<string, unknown>;
const attendanceRows = (workerId: bigint, skip: number[]): Row[] =>
  WEEKDAYS.filter((d) => !skip.includes(d)).map((d) => ({
    workerId,
    workDate: iso(d),
    startTime: new Date(Date.UTC(2026, 10, d, 0, 0)), // 09:00 KST
    endTime: new Date(Date.UTC(2026, 10, d, 9, 0)), // 18:00 KST (전일 9h − 휴게 1h = 8h)
    actualStartTime: null,
    actualEndTime: null,
    payrollConfirmedAt: null,
    assignment: {
      siteId: SITE, workType: "FULL_DAY", commuteGuidanceIncluded: true,
      customWorkStart: null, customWorkEnd: null, attendanceButtonExempt: false,
      site: { lateThresholdMin: null },
    },
    logs: [],
  }));

const W = { monthly: BigInt(1), hourly: BigInt(2), daily: BigInt(3), monthly2: BigInt(4) };
export const WORKER = W;

const payContract = (workerId: bigint, payType: string, baseAmount: number): Row => ({
  workerId, siteId: null, baseAmount, hourlyRate2Plus: null, payType, incomeType: "EMPLOYMENT", weeklyHolidayPay: null,
});
const empContract = (workerId: bigint): Row => ({
  workerId, workDaysPerWeek: 5, weeklyHoliday: "일", workingWeekdays: null,
  contractStart: new Date("2026-01-01T00:00:00.000Z"), contractEnd: new Date("2026-12-31T00:00:00.000Z"),
  workStartTime: "09:00", workEndTime: "18:00", breakStartTime: "12:00", breakEndTime: "13:00",
});

export type LeaveRow = { workerId: bigint; effectiveDate: Date; days: number };
/** 연차 사용(USE) 원장 행: days는 음수(부호합 원장). */
export const useRow = (workerId: bigint, day: number, days = 1): LeaveRow => ({
  workerId, effectiveDate: new Date(`${iso(day)}T00:00:00.000Z`), days: -days,
});

export const state: { leave: LeaveRow[] } = { leave: [] };

export function installPrismaMock() {
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      insuranceRates: { findFirst: async () => ({ year: 2026, nationalPension: 0.045, healthInsurance: 0.03545, longTermCare: 0.004591, employmentInsurance: 0.009, industrialAccident: 0.01, pensionBaseMin: null, pensionBaseMax: null }) },
      agency: { findUnique: async () => ({ lateThresholdMin: 30 }) },
      agencyDeduction: { findMany: async () => [] },
      incomeTaxTable: { findFirst: async () => ({ year: 2026, data: [], meta: {} }) },
      siteAssignment: {
        findMany: async () => Object.values(W).map((workerId) => ({ workerId, siteId: SITE, serviceStep: "FIELD_TRAINING", startDate: new Date("2026-01-01T00:00:00.000Z") })),
      },
      payContract: {
        findMany: async () => [
          payContract(W.monthly, "MONTHLY", 2090000),
          payContract(W.hourly, "HOURLY", 10030),
          payContract(W.daily, "DAILY", 80000),
          payContract(W.monthly2, "MONTHLY", 2090000),
        ],
      },
      dailyAttendance: {
        findMany: async (args: { where: { workDate: { lt?: string } } }) =>
          args.where.workDate.lt ? [] : [
            ...attendanceRows(W.monthly, [11, 12]),
            ...attendanceRows(W.hourly, [11]),
            ...attendanceRows(W.daily, [11]),
            ...attendanceRows(W.monthly2, [4]),
          ],
      },
      traineePlacement: { findMany: async () => [{ siteId: SITE, startDate: new Date("2026-01-01T00:00:00.000Z"), endDate: null }] },
      employmentContract: { findMany: async () => Object.values(W).map(empContract) },
      siteHoliday: { findMany: async () => [] },
      annualLeaveEntry: { findMany: async () => state.leave },
    },
  }));
}

export function normalize(items: { workerId: bigint; grossPay: { toString(): string }; totalDeduction: { toString(): string }; netPay: { toString(): string }; workedDays: number; workedMinutes: number; breakdown: object }[]) {
  return JSON.parse(JSON.stringify(
    items.map((i) => ({
      workerId: i.workerId.toString(),
      grossPay: i.grossPay.toString(), totalDeduction: i.totalDeduction.toString(), netPay: i.netPay.toString(),
      workedDays: i.workedDays, workedMinutes: i.workedMinutes, breakdown: i.breakdown,
    })),
  ));
}
