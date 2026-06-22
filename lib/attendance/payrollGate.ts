// lib/attendance/payrollGate.ts
// 급여 보호 게이트: "심한 지각(실제 출근이 표준보다 30분+ 늦음) 또는 심한 조퇴(실제 퇴근이
// 표준보다 30분+ 이름)인 날은 위탁기관 컨펌 전까지 출근부에 기본 표준시각을 확정하지 않는다."
// 출근부 = 급여 산정 근거이므로 오확정(과지급) 방지.
//
// 판정은 실제 버튼시각(actualStartTime/actualEndTime) 기준. 실제 시각이 없으면(과거 기록·기간
// 일괄생성) 해당 방향 게이트 미적용(오탐 방지). payrollConfirmedAt 가 채워지면(보정 승인/명시적
// 확정) 확정으로 본다.

import { computeWorkTimes } from "@/lib/workSchedule";

// 심한 지각 기준(분): 표준 출근시각보다 이만큼 이상 늦으면 컨펌 전 확정 보류.
export const SERIOUS_LATE_MIN = 30;
// 심한 조퇴 기준(분): 표준 퇴근시각보다 이만큼 이상 일찍 퇴근하면 컨펌 전 확정 보류.
export const SERIOUS_EARLY_LEAVE_MIN = 30;

function instantToKstMin(d: Date | null | undefined): number | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

function hhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface PayrollGateInput {
  actualStartTime: Date | null;
  actualEndTime?: Date | null;
  payrollConfirmedAt: Date | null;
  workType: string | null;
  commuteGuidanceIncluded: boolean | null;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  // 출퇴근 버튼 면제 배정이면 실제시각 무시 → 보정대기/지각·조퇴 판정 안 함.
  exempt?: boolean | null;
}

/** 표준 대비 실제 지각(분). 실제시각/표준 없으면 null. */
export function lateMinutes(a: PayrollGateInput): number | null {
  const actual = instantToKstMin(a.actualStartTime);
  if (actual == null) return null;
  const std = hhmmToMin(
    computeWorkTimes(a.workType, a.commuteGuidanceIncluded ?? true, a.customWorkStart, a.customWorkEnd).start,
  );
  if (std == null) return null;
  return actual - std;
}

/** 표준 대비 실제 조퇴(분, 양수=일찍 퇴근). 실제시각/표준 없으면 null. */
export function earlyLeaveMinutes(a: PayrollGateInput): number | null {
  const actual = instantToKstMin(a.actualEndTime ?? null);
  if (actual == null) return null;
  const std = hhmmToMin(
    computeWorkTimes(a.workType, a.commuteGuidanceIncluded ?? true, a.customWorkStart, a.customWorkEnd).end,
  );
  if (std == null) return null;
  return std - actual;
}

/**
 * 이 날의 출근부 시각이 "보정 대기(미확정)"인가?
 *  - 심한 지각(>=30분) 또는 심한 조퇴(>=30분) 이고, 아직 위탁기관 컨펌(payrollConfirmedAt) 전이면 true.
 *  - 보정 대기인 날은 출근부 PDF에 기본값을 박지 않고 "보정대기"로 표시한다.
 */
// thresholdMin: 위탁기관별 지각/조퇴 인정 기준(분). 미지정 시 기본 30(SERIOUS_LATE_MIN).
export function isPayrollPending(a: PayrollGateInput, thresholdMin: number = SERIOUS_LATE_MIN): boolean {
  if (a.exempt) return false;        // 버튼 면제 배정 → 실제시각 무시(보정대기 없음)
  if (a.payrollConfirmedAt) return false;
  const late = lateMinutes(a);
  if (late != null && late >= thresholdMin) return true;
  const early = earlyLeaveMinutes(a);
  return early != null && early >= thresholdMin;
}
