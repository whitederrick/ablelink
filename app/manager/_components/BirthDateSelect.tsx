"use client";

// 생년월일 입력 — 년/월/일 3개 드롭다운.
//  네이티브 <input type="date">는 1900년대생 선택 시 달력을 한참 넘겨야 해 고령/과거 출생 입력이 불편하다는
//  피드백(2026-07-19) 반영. 값은 상위와 동일한 "YYYY-MM-DD" 문자열(빈 값=미입력)로 주고받는다.
import { useMemo } from "react";

const T_SELECT = "h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate(); // month=1~12 → 그 달 말일
}

export default function BirthDateSelect({
  value, onChange, minYear = 1930, className = "",
}: {
  value: string;                       // "YYYY-MM-DD" 또는 ""
  onChange: (v: string) => void;       // 완성 시 "YYYY-MM-DD", 미완성 시 부분 채움 유지 위해 빈 필드는 ""로 합성
  minYear?: number;
  className?: string;
}) {
  const [y, m, d] = useMemo(() => {
    const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    return mt ? [Number(mt[1]), Number(mt[2]), Number(mt[3])] : [0, 0, 0];
  }, [value]);

  const thisYear = new Date().getFullYear();
  const years = useMemo(() => {
    const arr: number[] = [];
    for (let yr = thisYear; yr >= minYear; yr--) arr.push(yr);
    return arr;
  }, [thisYear, minYear]);
  const maxDay = daysInMonth(y, m);

  // 3필드를 합성 — 하나라도 비면 "" 반환(부분 입력은 저장 측에서 미입력으로 처리). 일자가 그 달 말일 초과면 보정.
  const emit = (ny: number, nm: number, nd: number) => {
    if (!ny || !nm || !nd) { onChange(""); return; }
    const clampedDay = Math.min(nd, daysInMonth(ny, nm));
    onChange(`${ny}-${String(nm).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`);
  };

  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      <select value={y || ""} onChange={(e) => emit(Number(e.target.value), m, d)} className={T_SELECT} aria-label="출생 연도">
        <option value="">년</option>
        {years.map((yr) => <option key={yr} value={yr}>{yr}년</option>)}
      </select>
      <select value={m || ""} onChange={(e) => emit(y, Number(e.target.value), d)} className={T_SELECT} aria-label="출생 월">
        <option value="">월</option>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => <option key={mo} value={mo}>{mo}월</option>)}
      </select>
      <select value={d || ""} onChange={(e) => emit(y, m, Number(e.target.value))} className={T_SELECT} aria-label="출생 일">
        <option value="">일</option>
        {Array.from({ length: maxDay }, (_, i) => i + 1).map((day) => <option key={day} value={day}>{day}일</option>)}
      </select>
    </div>
  );
}
