// lib/payroll/payslipPayload.ts
// PayrollItem(+breakdown) → 급여명세서 PDF payload 변환 단일 출처.
// admin(발급)·worker(교부 다운로드) 라우트 공용.

export interface PayslipMeta {
  agencyName: string;
  workerName: string;
  workerBirth?: string; // 생년월일 (없으면 빈칸 — 추후 보강)
  yearMonth: string; // 귀속월 YYYY-MM
  payDate?: string; // 지급일 YYYY-MM-DD
}

export interface PayslipItemData {
  grossPay: number;
  totalDeduction: number;
  netPay: number;
  workedDays: number | null;
  workedMinutes: number | null;
  breakdown: any;
}

export function buildPayslipPayload(meta: PayslipMeta, item: PayslipItemData) {
  const b = (item.breakdown ?? {}) as Record<string, any>;
  const calc = (b.calcMethods ?? {}) as Record<string, string>;

  const overtimePay = Number(b.overtimePay ?? 0);
  const weeklyHolidayPay = Number(b.weeklyHolidayPay ?? 0);
  const basePay = Math.round(Number(item.grossPay) - overtimePay - weeklyHolidayPay);

  // 지급내역
  const payRows: { name: string; amount: number; method?: string }[] = [
    { name: "기본급", amount: basePay, method: calc["기본급"] ?? "" },
  ];
  if (overtimePay > 0) payRows.push({ name: "연장근로수당", amount: overtimePay, method: calc["연장근로수당"] ?? "" });
  if (weeklyHolidayPay > 0) payRows.push({ name: "주휴수당", amount: weeklyHolidayPay, method: calc["주휴수당"] ?? "" });

  // 공제내역 (deductionBreakdown: { 항목명: 금액 })
  const ded = (b.deductionBreakdown ?? {}) as Record<string, number>;
  const deductRows = Object.entries(ded).map(([name, amount]) => ({ name, amount: Number(amount) }));

  const workedHours = item.workedMinutes != null ? +(item.workedMinutes / 60).toFixed(2) : 0;
  const overtimeHours = Number(b.overtimeHours ?? 0);

  return {
    agencyName: meta.agencyName,
    workerName: meta.workerName,
    workerBirth: meta.workerBirth ?? "",
    yearMonth: meta.yearMonth,
    payDate: meta.payDate ?? "",
    workedDays: item.workedDays ?? 0,
    workedHours,
    overtimeHours,
    payRows,
    deductRows,
    grossPay: Number(item.grossPay),
    totalDeduction: Number(item.totalDeduction),
    netPay: Number(item.netPay),
  };
}
