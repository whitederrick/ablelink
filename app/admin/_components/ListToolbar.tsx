// app/manager/_components/ListToolbar.tsx
// 매니저 콘솔 공통 조회 툴바 — 공통 텍스트 검색 + 화면별 멀티선택 상태필터 칩 + 추가 슬롯(기간 등).
// #20 표준: 모든 화면 공통 텍스트검색 1개 + 화면 특성에 맞는 버튼 필터(멀티선택) 유지.
"use client";

import type { ReactNode } from "react";
import { T } from "../_styles";

export interface FilterChip {
  value: string;
  label: string;
  count?: number;
}

export default function ListToolbar({
  query,
  onQueryChange,
  onSearch,
  placeholder = "검색",
  filters,
  selected,
  onToggleFilter,
  multi = true,
  extra,
}: {
  query: string;
  onQueryChange: (v: string) => void;
  onSearch?: () => void;
  placeholder?: string;
  /** 상태필터 칩(선택) */
  filters?: FilterChip[];
  /** 선택된 필터 값들 */
  selected?: string[];
  onToggleFilter?: (value: string) => void;
  /** true=멀티선택, false=단일선택 */
  multi?: boolean;
  /** 기간 등 화면 특수 조건 슬롯 */
  extra?: ReactNode;
}) {
  const sel = selected ?? [];
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && onSearch) onSearch(); }}
          placeholder={placeholder}
          className={`min-w-[220px] flex-1 ${T.input}`}
        />
        {onSearch && <button onClick={onSearch} className={T.btnSecondary}>검색</button>}
        {extra}
      </div>

      {filters && filters.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.map(f => {
            const active = sel.includes(f.value);
            return (
              <button
                key={f.value}
                onClick={() => onToggleFilter?.(f.value)}
                className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] font-bold transition ${
                  active
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                {f.label}{f.count != null ? ` ${f.count}` : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
