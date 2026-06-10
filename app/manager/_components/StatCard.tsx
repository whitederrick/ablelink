// app/manager/_components/StatCard.tsx
// 매니저 콘솔 공통 대시보드 카드 — 숫자·라벨 폰트/크기/색을 단일 기준으로 통일(화면별 제각각 방지).
"use client";

import type { ReactNode } from "react";

export type StatTone = "slate" | "sky" | "emerald" | "amber" | "rose" | "violet";

const NUM_CLS: Record<StatTone, string> = {
  slate:   "text-slate-900",
  sky:     "text-sky-600",
  emerald: "text-emerald-600",
  amber:   "text-amber-600",
  rose:    "text-rose-600",
  violet:  "text-violet-600",
};

export interface StatItem {
  label: string;
  value: ReactNode;
  tone?: StatTone;
  sub?: string;
}

export function StatCard({ label, value, tone = "slate", sub }: StatItem) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 text-center">
      <div className={`text-3xl font-black leading-none ${NUM_CLS[tone]}`}>{value}</div>
      <div className="mt-1.5 text-xs font-semibold text-slate-400">{label}</div>
      {sub && <div className="mt-0.5 text-[11px] font-medium text-slate-300">{sub}</div>}
    </div>
  );
}

// 카드 행 — 반응형 그리드(기본 4열). cols로 조정.
export function StatCardRow({ items, cols = 4, className = "" }: { items: StatItem[]; cols?: 2 | 3 | 4 | 5; className?: string }) {
  const colCls = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4", 5: "sm:grid-cols-5" }[cols];
  return (
    <div className={`grid grid-cols-2 gap-3 ${colCls} ${className}`}>
      {items.map((it, i) => <StatCard key={i} {...it} />)}
    </div>
  );
}

export default StatCard;
