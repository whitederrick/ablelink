// lib/attendance/overtime.ts
// 퇴근시각(actualEndTime) 기준 연장근로 자동 산정 — 급여계산·출근부 PDF 공통 단일 출처.
//
// 규칙(2026-06-18 사용자 확정):
//  · 전일(FULL_DAY): 정규 종료(09:00~18:00) 후 18:00~19:00은 저녁식사 1시간(무급, 근무·연장 모두 미포함).
//    → 연장은 19:00 이후. 1h 연장이면 09:00~20:00(중간 식사 1h 제외).
//  · 오전/오후/커스텀: 저녁식사 공제 없음 — 정규 종료시각 이후 퇴근시각까지 전부 연장.
//  · 연장은 분 단위(실시간). 반올림 없음.
//  · 퇴근 미실행(actualEndTime 없음)·출퇴근버튼 면제 자동기록 배정은 자동 산정 불가 → 0.

import { computeWorkTimes } from "@/lib/workSchedule";

const FULL_DAY_DINNER_MIN = 60; // 전일 연장 시 저녁식사(무급) 1시간

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
// 저장된 UTC instant → KST 벽시계 분(0~1439). (자정 넘김은 비대상)
function kstMinutes(d: Date): number {
  const k = new Date(d.getTime() + 9 * 3600000);
  return k.getUTCHours() * 60 + k.getUTCMinutes();
}

/**
 * 하루 연장근로 "분" 결정 — 출퇴근버튼 면제 배정은 수동입력, 그 외는 퇴근시각 자동.
 *  · 면제(자동기록) 배정: 퇴근시각이 없으므로 직무지도원 수동입력(시간) 사용.
 *  · 일반(버튼) 배정: 퇴근시각 기준 자동 산정.
 */
export function overtimeMinutesForDay(opts: {
  workType: string | null | undefined;
  exempt: boolean | null | undefined;
  actualEndTime: Date | null | undefined;
  commuteGuidanceIncluded?: boolean | null;
  customWorkStart?: string | null;
  customWorkEnd?: string | null;
  manualExtHours?: number | null; // 면제 배정 수동입력(시간)
}): number {
  if (opts.exempt) return Math.max(0, Math.round((opts.manualExtHours ?? 0) * 60));
  return computeOvertimeMinutes(
    opts.workType, opts.actualEndTime,
    opts.commuteGuidanceIncluded, opts.customWorkStart, opts.customWorkEnd,
  );
}

/**
 * 하루 "실효 근무 종료" 벽시계 분(KST 0~1439) — 야간(22:00+)·휴일 가산 검출용 단일 출처.
 *  · 면제(자동기록) 배정: 실제 퇴근시각이 없으므로 [고정 종료 + (전일이면 저녁식사 1h) + 수동입력 연장]으로 산정.
 *    → 면제 배정의 수동 연장도 야간창(22:00+)에 닿으면 야간가산이 잡힌다.
 *  · 일반(버튼) 배정: 실제 퇴근시각(actualEndTime)과 고정 종료 중 늦은 쪽(기존 동작 보존). 없으면 고정 종료.
 *  · 자정 넘김은 비대상(기존 가정 유지).
 */
export function workEndMinutesForDay(opts: {
  workType: string | null | undefined;
  exempt: boolean | null | undefined;
  scheduledEndMin: number;        // 고정 종료(벽시계 분)
  actualEndTime?: Date | null;
  manualExtHours?: number | null; // 면제 배정 수동입력(시간)
}): number {
  if (opts.exempt) {
    const otMin = Math.max(0, Math.round((opts.manualExtHours ?? 0) * 60));
    if (otMin <= 0) return opts.scheduledEndMin;
    const dinner = opts.workType === "FULL_DAY" ? FULL_DAY_DINNER_MIN : 0;
    return opts.scheduledEndMin + dinner + otMin;
  }
  return opts.actualEndTime
    ? Math.max(opts.scheduledEndMin, kstMinutes(opts.actualEndTime))
    : opts.scheduledEndMin;
}

/** 퇴근시각 기준 연장근로 "분" 자동 산정. */
export function computeOvertimeMinutes(
  workType: string | null | undefined,
  actualEndTime: Date | null | undefined,
  commuteGuidanceIncluded?: boolean | null,
  customWorkStart?: string | null,
  customWorkEnd?: string | null,
): number {
  if (!actualEndTime) return 0;
  const wt = computeWorkTimes(workType, commuteGuidanceIncluded ?? true, customWorkStart, customWorkEnd);
  const scheduledEndMin = hhmmToMin(wt.end);
  const dinnerMin = workType === "FULL_DAY" ? FULL_DAY_DINNER_MIN : 0;
  const overtimeStartMin = scheduledEndMin + dinnerMin; // 이 시각 이후가 연장
  const actualMin = kstMinutes(actualEndTime);
  return Math.max(0, actualMin - overtimeStartMin);
}
