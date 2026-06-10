// app/manager/_components/Pagination.tsx
// 매니저 콘솔 공통 페이지네이션 — 전 목록 화면 동일 UX(총 N건 · page x/y · 이전/다음).
"use client";

import { T } from "../_styles";

export default function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
  className = "",
}: {
  page: number;
  totalPages: number;
  total?: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const tp = Math.max(1, totalPages);
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <span className="text-xs font-semibold text-slate-400">
        {total != null ? `총 ${total.toLocaleString()}건 · ` : ""}page {page} / {tp}
      </span>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}
          className={`${T.btnSecondary} disabled:opacity-40`}>이전</button>
        <span className="text-sm font-semibold text-slate-500">{page} / {tp}</span>
        <button disabled={page >= tp} onClick={() => onPageChange(Math.min(tp, page + 1))}
          className={`${T.btnSecondary} disabled:opacity-40`}>다음</button>
      </div>
    </div>
  );
}
