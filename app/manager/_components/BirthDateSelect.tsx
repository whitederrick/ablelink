"use client";

// 생년월일 입력 — 년/월/일 3개 드롭다운.
//  네이티브 <input type="date">는 1900년대생 선택 시 달력을 한참 넘겨야 해 고령/과거 출생 입력이 불편하다는
//  피드백(2026-07-19) 반영. 값은 상위와 동일한 "YYYY-MM-DD" 문자열(빈 값=미입력)로 주고받는다.
//
// ★부분입력 유지(2026-07-19 회귀수정): 세 필드를 다 채우기 전에도 선택이 남아야 한다. 이전 구현은 로컬 state
//  없이 부모 value에서만 파생해, 미완성 시 항상 onChange("")를 호출 → 부모 value가 ""로 남고 리렌더 시 방금 고른
//  값이 "년/월/일"로 되돌아가 '빈 값에서의 신규 입력'이 원천 불가했다. 이제 부분 선택을 로컬 state로 보관하고,
//  세 값이 모두 차야 부모로 "YYYY-MM-DD"를 방출한다(미완성은 부모엔 ""이되 화면 선택은 유지).
import { useEffect, useState } from "react";

const T_SELECT = "h-10 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

function daysInMonth(year: number, month: number): number {
  if (!year || !month) return 31;
  return new Date(year, month, 0).getDate(); // month=1~12 → 그 달 말일
}
function parse(value: string): { y: number; m: number; d: number } {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return mt ? { y: Number(mt[1]), m: Number(mt[2]), d: Number(mt[3]) } : { y: 0, m: 0, d: 0 };
}

export default function BirthDateSelect({
  value, onChange, minYear = 1930, className = "",
}: {
  value: string;                       // "YYYY-MM-DD" 또는 ""
  onChange: (v: string) => void;       // 세 값 완성 시 "YYYY-MM-DD", 미완성 시 ""
  minYear?: number;
  className?: string;
}) {
  // 로컬 부분입력 state — 부분 선택을 화면에 유지한다.
  const [ymd, setYmd] = useState(() => parse(value));

  // 부모 value가 '외부에서' 바뀌면(다른 대상 로딩 등) 로컬 state를 동기화.
  //  현재 로컬 state가 만들어낼 문자열과 다를 때만 반영해 자기 변경으로 인한 루프를 피한다.
  useEffect(() => {
    const cur = ymd.y && ymd.m && ymd.d
      ? `${ymd.y}-${String(ymd.m).padStart(2, "0")}-${String(Math.min(ymd.d, daysInMonth(ymd.y, ymd.m))).padStart(2, "0")}`
      : "";
    if ((value || "") !== cur) setYmd(parse(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let yr = thisYear; yr >= minYear; yr--) years.push(yr);
  const maxDay = daysInMonth(ymd.y, ymd.m);
  // 부분 입력(하나라도 골랐는데 셋이 안 참) — 저장 시 조용히 미저장되므로 명시 경고(정보성).
  const partial = (!!ymd.y || !!ymd.m || !!ymd.d) && !(ymd.y && ymd.m && ymd.d);

  // 필드 변경 → 로컬 state 갱신 + 세 값 완성 시에만 부모로 방출(미완성은 ""). 일자는 그 달 말일 초과 시 클램프.
  const set = (patch: Partial<typeof ymd>) => {
    const next = { ...ymd, ...patch };
    if (next.y && next.m && next.d) next.d = Math.min(next.d, daysInMonth(next.y, next.m));
    setYmd(next);
    onChange(next.y && next.m && next.d
      ? `${next.y}-${String(next.m).padStart(2, "0")}-${String(next.d).padStart(2, "0")}`
      : "");
  };

  return (
    <div className={className}>
      <div className="grid grid-cols-3 gap-2">
        <select value={ymd.y || ""} onChange={(e) => set({ y: Number(e.target.value) })} className={T_SELECT} aria-label="출생 연도">
          <option value="">년</option>
          {years.map((yr) => <option key={yr} value={yr}>{yr}년</option>)}
        </select>
        <select value={ymd.m || ""} onChange={(e) => set({ m: Number(e.target.value) })} className={T_SELECT} aria-label="출생 월">
          <option value="">월</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => <option key={mo} value={mo}>{mo}월</option>)}
        </select>
        <select value={ymd.d || ""} onChange={(e) => set({ d: Number(e.target.value) })} className={T_SELECT} aria-label="출생 일">
          <option value="">일</option>
          {Array.from({ length: maxDay }, (_, i) => i + 1).map((day) => <option key={day} value={day}>{day}일</option>)}
        </select>
      </div>
      {partial && <p className="mt-1 text-[11px] font-semibold text-rose-500" role="alert">년·월·일을 모두 선택해야 저장됩니다.</p>}
    </div>
  );
}
