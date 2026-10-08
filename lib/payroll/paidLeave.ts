// lib/payroll/paidLeave.ts
// 연차 사용일(AnnualLeaveEntry.kind=USE)의 급여 반영 — 순수 로직(2026-10-08, 연차모듈 '2차').
//
// 배경: 연차 모듈(2026-07-15)은 급여엔진이 USE 원장을 모르는 채로 출시됐다(사용일 유급 자동화는 2차 보류).
//  그 결과 승인된 연차일이 급여에서 '결근'처럼 처리됐다 — 월급제는 일할로 감액되고, 시급·일급제는 그 주 개근이
//  깨져 주휴수당이 탈락했으며 연차일 자체의 임금도 0원이었다(유급연차 라인은 항상 0).
//
// 규칙(연차 모듈 기존 관례와 동일: accrual.ts '연차 사용일=출근 간주'):
//  · 소정근로일(근무요일 ∩ 비공휴일)에 걸친 USE만 인정한다. 휴일·비소정일 등록분은 무시(임금 증감 없음).
//  · 같은 날짜의 USE 일수는 합산하되 하루 1.0을 상한으로 한다(0.25/0.5 반차 포함).
//  · 인정일은 월급제 일할 분자·주휴 개근 판정에서 '출근한 날'로 센다.

export type LeaveUseRow = { effectiveDate: Date; days: unknown };

/** 원장 effectiveDate(해당 날짜 UTC 자정) → "YYYY-MM-DD". */
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export function buildPaidLeaveCredit(args: {
  rows: LeaveUseRow[];
  workingWeekdays: Set<number>;
  holidaySet: Set<string>;
}): { credit: Map<string, number>; ignored: Map<string, number> } {
  const sum = new Map<string, number>();
  for (const r of args.rows) {
    const n = Math.abs(Number(r.days));
    if (!Number.isFinite(n) || n <= 0) continue;
    const key = isoOf(r.effectiveDate);
    sum.set(key, (sum.get(key) ?? 0) + n);
  }
  const credit = new Map<string, number>();
  const ignored = new Map<string, number>();
  for (const [date, total] of sum) {
    const [y, m, d] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const scheduled = args.workingWeekdays.has(dow) && !args.holidaySet.has(date);
    (scheduled ? credit : ignored).set(date, scheduled ? Math.min(1, total) : total);
  }
  return { credit, ignored };
}

export const sumCredit = (m: Map<string, number>) => {
  let s = 0;
  for (const v of m.values()) s += v;
  return Math.round(s * 100) / 100;
};

/** 시급제 연차일 임금 = Σ일수 × 1일 소정근로시간 × 통상시급. (반차 근무 시 근로 시간분은 별도 지급 → 합산) */
export function hourlyLeavePay(args: { credit: Map<string, number>; dailySojeMin: number; wage: number }) {
  const hours = (sumCredit(args.credit) * args.dailySojeMin) / 60;
  return { hours, pay: Math.round(hours * args.wage) };
}

/** 일급제 연차일 임금 = (출근 없는 인정일) × 일급. 출근한 날은 이미 일급 1건이 지급돼 중복 방지. */
export function dailyLeavePay(args: { credit: Map<string, number>; workedDates: Set<string>; dailyRate: number }) {
  let days = 0;
  for (const [date, v] of args.credit) if (!args.workedDates.has(date)) days += v;
  days = Math.round(days * 100) / 100;
  return { days, pay: Math.round(days * args.dailyRate) };
}
