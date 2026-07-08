// lib/payroll/payslipPayload.ts
// PayrollItem(+breakdown) → 급여명세서 PDF payload 변환 단일 출처.
// admin(발급)·worker(교부 다운로드) 라우트 공용.
// 신양식(샘플): breakdown.payLines/deductLines/basicInfo 기반. 없으면 레거시(기본급/연장/주휴) 폴백.
import type { PayrollBreakdown } from "@/lib/payroll/breakdown";

export interface PayslipMeta {
  agencyName: string;
  workerName: string;
  workerBirth?: string; // 생년월일
  yearMonth: string; // 귀속월 YYYY-MM
  payDate?: string; // 지급일 YYYY-MM-DD
}

export interface PayslipItemData {
  grossPay: number;
  totalDeduction: number;
  netPay: number;
  workedDays: number | null;
  workedMinutes: number | null;
  breakdown: unknown;
}

export function buildPayslipPayload(meta: PayslipMeta, item: PayslipItemData) {
  const b = (item.breakdown ?? {}) as PayrollBreakdown;
  const calc = (b.calcMethods ?? {}) as Record<string, string>;
  const basic = (b.basicInfo ?? {}) as Record<string, any>;

  // ── 지급내역 ──
  let payRows: { name: string; hours?: number; amount: number; method?: string }[];
  if (Array.isArray(b.payLines) && b.payLines.length) {
    payRows = b.payLines.map((l: any) => ({ name: l.name, hours: Number(l.hours) || 0, amount: Number(l.amount) || 0, method: l.method ?? "" }));
  } else {
    // 레거시 폴백
    const overtimePay = Number(b.overtimePay ?? 0);
    const weeklyHolidayPay = Number(b.weeklyHolidayPay ?? 0);
    const basePay = Math.round(Number(item.grossPay) - overtimePay - weeklyHolidayPay);
    payRows = [{ name: "기본급", amount: basePay, method: calc["기본급"] ?? "" }];
    if (overtimePay > 0) payRows.push({ name: "연장근로수당", amount: overtimePay, method: calc["연장근로수당"] ?? "" });
    if (weeklyHolidayPay > 0) payRows.push({ name: "주휴수당", amount: weeklyHolidayPay, method: calc["주휴수당"] ?? "" });
  }

  // ── 공제내역 ──
  let deductRows: { name: string; amount: number }[];
  if (Array.isArray(b.deductLines) && b.deductLines.length) {
    deductRows = b.deductLines.map((l: any) => ({ name: l.name, amount: Number(l.amount) || 0 }));
  } else {
    const ded = (b.deductionBreakdown ?? {}) as Record<string, number>;
    deductRows = Object.entries(ded).map(([name, amount]) => ({ name, amount: Number(amount) }));
  }

  const workedHours = item.workedMinutes != null ? +(item.workedMinutes / 60).toFixed(2) : 0;
  const totalHours = b.totalHours != null ? Number(b.totalHours) : workedHours;

  return {
    agencyName: meta.agencyName,
    workerName: meta.workerName,
    workerBirth: meta.workerBirth ?? "",
    yearMonth: meta.yearMonth,
    payDate: meta.payDate ?? "",
    // 기본사항(샘플)
    job: basic.job ?? "직무지도",
    placementType: basic.placementType ?? "",
    placementDate: basic.placementDate ?? "",
    workedDays: item.workedDays ?? 0,
    workedHours,
    totalHours,
    overtimeHours: Number(b.overtimeHours ?? 0),
    payRows,
    deductRows,
    grossPay: Number(item.grossPay),
    totalDeduction: Number(item.totalDeduction),
    netPay: Number(item.netPay),
    // 산재보험 — 전액 사업주 부담(워커 공제 아님). 비고 표기용.
    employerIndustrial: Number(b.insurance?.employerIndustrial ?? 0),
  };
}
