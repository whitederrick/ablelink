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
}

/** 결근일 목록("YYYY-MM-DD") 반환. */
export function computeAbsentDates(opts: AbsentDaysOpts): string[] {
  const publicHolidays = new Set(getKrHolidayDates(opts.from, opts.to));
  const custom = opts.customHolidays ?? new Set<string>();
  const redFrom = opts.assignStart > opts.from ? opts.assignStart : opts.from;
  const endBase = opts.assignEnd && opts.assignEnd < opts.todayStr ? opts.assignEnd : opts.todayStr;
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
