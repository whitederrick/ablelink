// lib/attendance/absentDays.ts
// 결근(미출근) 날짜 산출 단일 출처 — 워커 캘린더/월간·매니저 근태 월별현황이 동일 규칙을 쓰도록.
//
// 규칙: 배정 근무 기간 내 · 오늘 이하(미래 제외) · 평일 · 공휴일/커스텀휴무 아님 · 출근기록 없는 날 = 결근.
// (주말·공휴일·커스텀휴무는 소정근로일이 아니므로 결근 아님 → 급여 소정근로일 기준과 일치.)

import { getKrHolidayDates } from "@/lib/krHolidays";

export interface AbsentDaysOpts {
  /** 조회 기간(포함) "YYYY-MM-DD" */
  from: string;
  to: string;
  /** 배정 시작일 "YYYY-MM-DD" */
  assignStart: string;
  /** 배정 종료일 "YYYY-MM-DD" 또는 null(진행중) */
  assignEnd: string | null;
  /** KST 오늘 "YYYY-MM-DD" — 미래일은 결근 아님 */
  todayStr: string;
  /** 출근기록이 있는 날짜 집합(그 워커·기간) */
  existingDates: Set<string>;
  /** 현장 커스텀 휴무 날짜 집합(옵션) */
  customHolidays?: Set<string>;
  /**
   * 출퇴근 면제 배정(#14): 당일 출근기록은 '다음날' 크론이 생성하므로 오늘은 아직 결근 판정 불가.
   * true면 오늘을 결근에서 제외(어제까지만 판정) — 캘린더 route와 동일 규칙으로 두 화면 결근을 일치시킨다.
   */
  exemptToday?: boolean;
}

/** 결근일 목록("YYYY-MM-DD") 반환. */
export function computeAbsentDates(opts: AbsentDaysOpts): string[] {
  const publicHolidays = new Set(getKrHolidayDates(opts.from, opts.to));
  const custom = opts.customHolidays ?? new Set<string>();
  const redFrom = opts.assignStart > opts.from ? opts.assignStart : opts.from;
  // 면제 배정은 '오늘'을 아직 결근으로 볼 수 없으므로 판정 상한을 어제로 당긴다.
  const effectiveToday = opts.exemptToday ? prevDayStr(opts.todayStr) : opts.todayStr;
  const endBase = opts.assignEnd && opts.assignEnd < effectiveToday ? opts.assignEnd : effectiveToday;
  const redTo = endBase < opts.to ? endBase : opts.to;
  const out: string[] = [];
  if (redFrom > redTo) return out;
  // 날짜 문자열 기준 순회(UTC Z-date로 요일 파생 — 서버 TZ 무관).
  const cur = new Date(redFrom + "T00:00:00Z");
  const end = new Date(redTo + "T00:00:00Z");
  while (cur.getTime() <= end.getTime()) {
    const key = cur.toISOString().slice(0, 10);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6 && !publicHolidays.has(key) && !custom.has(key) && !opts.existingDates.has(key)) {
      out.push(key);
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** "YYYY-MM-DD"의 전날(UTC Z-date 기준 — computeAbsentDates 순회와 동일 프레임). */
function prevDayStr(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
