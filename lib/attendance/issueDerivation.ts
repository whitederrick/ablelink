// lib/attendance/issueDerivation.ts
// 근태 이슈 유형 도출의 "단일 출처". 대시보드(미확인 근태 카운트)와 근태 이슈 인박스가 동일 규칙을 쓰도록 통합.
// (이전엔 dashboard/route.ts·attendance-inbox/route.ts에 서로 다른 도출 로직이 있어 숫자가 어긋났음)
//
// 규칙(인박스 기준으로 통일, 2026-06-30):
//  - MISSING_CLOCK_IN: 출근시각(startTime) 없음
//  - MISSING_CLOCK_OUT: 퇴근시각(endTime) 없음. 단 "오늘 + 아직 WORKING"(근무 진행중)은 제외(오탐 방지)
//  - OUT_OF_RANGE: 출근 거리 > 허용 반경
//  - TIME_ANOMALY(지각): 실제 출근 버튼 시각(actualStartTime)이 근무형태 표준 출근시각보다
//    lateThresholdMin 이상 늦음. 실제 시각이 없으면(과거·일괄생성) 판정 안 함.
//  - 출퇴근 면제(attendanceButtonExempt) 배정은 호출부에서 제외(여기선 다루지 않음).

import { computeWorkTimes } from "@/lib/workSchedule";

export type AttendanceIssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "TIME_OUTLIER" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";

// 출퇴근 시간 이상(TIME_OUTLIER) 판정 기본 마진(분) — 표준 대비 이만큼 이른 출근/늦은 퇴근이면 이상.
export const TIME_OUTLIER_MARGIN_MIN = 60;

// 대시보드·인박스 공용 기본 조회 기간(일). 두 화면의 '미확인 근태' 모집단을 같게 맞추는 기준.
export const ATTENDANCE_ISSUE_WINDOW_DAYS = 14;

export interface AttendanceIssueRow {
  startTime: Date | null;
  endTime: Date | null;
  actualStartTime: Date | null;
  actualEndTime: Date | null;
  startDistanceM: number | null;
  rangeM: number | null;
  workType: string | null;
  commuteGuidanceIncluded: boolean | null;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  status: string;       // DailyAttendance.status (WORKING 등)
  workDate: string;     // "YYYY-MM-DD" (KST)
}

function hhmmToMin(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 저장 instant(UTC) → KST 벽시계 분(0~1439). 서버 UTC 가정 +9h.
function instantToKstMin(d: Date | null | undefined): number | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() * 60 + kst.getUTCMinutes();
}

/** 근무형태 표준 출근시각(HH:MM). workType 없으면 null. */
export function expectedStartHHMM(row: Pick<AttendanceIssueRow, "workType" | "commuteGuidanceIncluded" | "customWorkStart" | "customWorkEnd">): string | null {
  if (!row.workType) return null;
  return computeWorkTimes(row.workType, row.commuteGuidanceIncluded ?? true, row.customWorkStart, row.customWorkEnd).start;
}

/**
 * 근태 이슈 유형 도출.
 * @param lateThresholdMin 지각 판정 임계(분) — 운영설정값 LATE_THRESHOLD_MIN.
 * @param todayStr KST 기준 오늘("YYYY-MM-DD"). "오늘+WORKING" 퇴근누락 제외에 사용.
 */
export function deriveAttendanceIssues(
  row: AttendanceIssueRow,
  opts: { lateThresholdMin: number; todayStr: string; outlierMarginMin?: number },
): AttendanceIssueType[] {
  const out: AttendanceIssueType[] = [];

  if (!row.startTime) out.push("MISSING_CLOCK_IN");
  if (!row.endTime && !(row.workDate === opts.todayStr && row.status === "WORKING")) out.push("MISSING_CLOCK_OUT");

  if (row.startDistanceM != null && row.rangeM != null && row.startDistanceM > row.rangeM) {
    out.push("OUT_OF_RANGE");
  }

  const expectedStartMin = hhmmToMin(expectedStartHHMM(row));
  const actualStartMin = instantToKstMin(row.actualStartTime);
  if (expectedStartMin != null && actualStartMin != null && actualStartMin - expectedStartMin >= opts.lateThresholdMin) {
    out.push("TIME_ANOMALY");
  }

  // 출퇴근 시간 이상(TIME_OUTLIER) — 지각과 별개. ① 시각 역전(퇴근≤출근) ② 표준 대비 극단 이탈.
  const margin = opts.outlierMarginMin ?? TIME_OUTLIER_MARGIN_MIN;
  const expectedEndMin = row.workType
    ? hhmmToMin(computeWorkTimes(row.workType, row.commuteGuidanceIncluded ?? true, row.customWorkStart, row.customWorkEnd).end)
    : null;
  const actualEndMin = instantToKstMin(row.actualEndTime);
  const inverted = row.actualStartTime != null && row.actualEndTime != null && row.actualEndTime.getTime() <= row.actualStartTime.getTime();
  const tooEarlyIn = expectedStartMin != null && actualStartMin != null && expectedStartMin - actualStartMin >= margin; // 표준보다 margin 이상 이른 출근
  const tooLateOut = expectedEndMin != null && actualEndMin != null && actualEndMin - expectedEndMin >= margin;          // 표준보다 margin 이상 늦은 퇴근
  if (inverted || tooEarlyIn || tooLateOut) {
    out.push("TIME_OUTLIER");
  }

  return out;
}
