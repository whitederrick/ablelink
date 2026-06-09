// lib/workSchedule.ts
// 근무형태별 표준 출퇴근 시각의 "단일 출처(single source of truth)".
// 정책 변경 시 이 파일만 수정한다. (clock-in/out, 배정 수정, 출근부 인박스, 일괄생성 모두 사용)
//
// 규칙(2026-06-09 확정):
//  - 오전 4시간(AM): 출퇴근지도+휴게지도 포함(기본) → 08:30~13:30 / 미포함(예외) → 09:00~13:30
//  - 오후 4시간(PM): 포함(기본) → 12:30~17:30 / 미포함(예외) → 13:00~17:30
//  - 전일 8시간(FULL_DAY): 출퇴근지도 강제 미포함(8시간 초과 금지) → 09:00~18:00
//  - CUSTOM: 관리자가 지정한 customWorkStart~customWorkEnd (미지정 시 전일 기본)
//
// 4시간 근무 원칙: 근무 4h + 휴게 30분.
//  · 미포함(예외): AM 09:00~13:30 / PM 13:00~17:30 (휴게 30분 포함, 4.5h)
//  · 포함(기본): 출근 전 30분 출퇴근지도를 앞에 더해 AM 08:30~13:30 / PM 12:30~17:30 (5h)

export const VALID_WORK_TYPES = ["AM", "PM", "FULL_DAY", "CUSTOM"] as const;
export type WorkType = (typeof VALID_WORK_TYPES)[number];

export const WORK_TYPE_LABELS: Record<WorkType, string> = {
  AM: "오전 4시간",
  PM: "오후 4시간",
  FULL_DAY: "전일 8시간",
  CUSTOM: "직접입력",
};

export function isWorkType(v: unknown): v is WorkType {
  return typeof v === "string" && (VALID_WORK_TYPES as readonly string[]).includes(v);
}

export interface WorkTimes {
  start: string; // "HH:MM" (KST 벽시계)
  end: string; // "HH:MM"
}

const FALLBACK: WorkTimes = { start: "09:00", end: "18:00" };

/**
 * 근무형태 + 출퇴근지도 포함 여부 → 표준 출퇴근 시각(HH:MM).
 * @param commuteGuidanceIncluded AM/PM에서 출퇴근지도+휴게지도 포함 여부(기본 true). FULL_DAY/CUSTOM에서는 무시.
 */
export function computeWorkTimes(
  workType: WorkType | string | null | undefined,
  commuteGuidanceIncluded: boolean = true,
  customWorkStart?: string | null,
  customWorkEnd?: string | null,
): WorkTimes {
  switch (workType) {
    case "AM":
      return commuteGuidanceIncluded
        ? { start: "08:30", end: "13:30" }
        : { start: "09:00", end: "13:30" };
    case "PM":
      return commuteGuidanceIncluded
        ? { start: "12:30", end: "17:30" }
        : { start: "13:00", end: "17:30" };
    case "FULL_DAY":
      return { start: "09:00", end: "18:00" };
    case "CUSTOM":
      return {
        start: customWorkStart ?? FALLBACK.start,
        end: customWorkEnd ?? FALLBACK.end,
      };
    default:
      return FALLBACK;
  }
}

/**
 * KST(UTC+9) 벽시계 기준 (날짜 + HH:MM) → 저장용 Date(UTC instant).
 * 서버는 UTC, 화면은 브라우저(KST)에서 getHours()로 렌더링하므로
 * 표시 시 정확히 HH:MM 으로 보이도록 -9h 보정한 instant 를 만든다.
 * @param workDate "YYYY-MM-DD" (KST 날짜)
 * @param hhmm "HH:MM"
 */
export function kstWallTimeToInstant(workDate: string, hhmm: string): Date {
  const [y, m, d] = workDate.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  // KST 벽시계 (y-m-d hh:mm) == UTC (… hh-9:mm). Date.UTC 가 음수/자정넘김 자동 처리.
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm, 0, 0));
}
