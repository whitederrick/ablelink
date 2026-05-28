"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

type ReviewRow = {
  userId: string;
  userName: string;
  phoneNumber: string;
  siteName: string;
  attendance:  { total: number; confirmed: number };
  logs:        { total: number; confirmed: number };
  evaluations: { total: number; confirmed: number };
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nowYM() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function ProgressBadge({ confirmed, total }: { confirmed: number; total: number }) {
  if (total === 0) return <span className="text-xs font-semibold text-slate-300">-</span>;
  const done = confirmed >= total;
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
      done ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
    }`}>
      {confirmed}/{total}
    </span>
  );
}

export default function AdminReviewPage() {
  const [yearMonth, setYearMonth] = useState(nowYM());
  const [rows, setRows]           = useState<ReviewRow[]>([]);
  const [loading, setLoading]     = useState(false);

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/review?yearMonth=${yearMonth}`)
      .then(r => r.json())
      .then(d => { if (d.success) setRows(d.rows); })
      .finally(() => setLoading(false));
  }, [yearMonth]);

  const fullyDone = rows.filter(r =>
    r.attendance.confirmed >= r.attendance.total &&
    r.logs.confirmed >= r.logs.total &&
    (r.evaluations.total === 0 || r.evaluations.confirmed >= r.evaluations.total)
  ).length;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">확정 현황</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">직무지도원별 출근부·일지·평가 확정 상태</p>
        </div>
        {/* 월 선택 */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <button onClick={() => changeMonth(-1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[80px] text-center text-sm font-black text-slate-900">
            {yearMonth.replace("-", "년 ")}월
          </span>
          <button onClick={() => changeMonth(1)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 요약 */}
      {rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 text-center">
            <p className="text-2xl font-black text-slate-900">{rows.length}</p>
            <p className="mt-1 text-xs font-semibold text-slate-400">직무지도원 수</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-4 text-center">
            <p className="text-2xl font-black text-emerald-600">{fullyDone}</p>
            <p className="mt-1 text-xs font-semibold text-emerald-500">전체 확정 완료</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-center">
            <p className="text-2xl font-black text-amber-600">{rows.length - fullyDone}</p>
            <p className="mt-1 text-xs font-semibold text-amber-500">미확정 있음</p>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm font-semibold text-slate-400">해당 기간에 데이터가 없습니다.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-left text-xs font-black text-slate-500">직무지도원</th>
                <th className="px-4 py-3 text-left text-xs font-black text-slate-500">사업체</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">출근부</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">일지</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">종합평가</th>
                <th className="px-4 py-3 text-center text-xs font-black text-slate-500">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => {
                const allDone =
                  r.attendance.confirmed >= r.attendance.total &&
                  r.logs.confirmed >= r.logs.total &&
                  (r.evaluations.total === 0 || r.evaluations.confirmed >= r.evaluations.total);
                return (
                  <tr key={r.userId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-black text-slate-900">{r.userName}</p>
                      <p className="text-xs font-semibold text-slate-400">{r.phoneNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-600">{r.siteName}</td>
                    <td className="px-4 py-3 text-center">
                      <ProgressBadge confirmed={r.attendance.confirmed} total={r.attendance.total} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ProgressBadge confirmed={r.logs.confirmed} total={r.logs.total} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ProgressBadge confirmed={r.evaluations.confirmed} total={r.evaluations.total} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-black ${
                        allDone
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-amber-50 text-amber-600"
                      }`}>
                        {allDone ? "완료" : "미완료"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold leading-relaxed text-slate-500">
          · 직무지도원이 직접 확정한 기록만 집계됩니다.<br />
          · 출근부 미확정은 익일 자정에 자동 확정 처리됩니다.<br />
          · 확정/전체 형식으로 표시됩니다.
        </p>
      </div>
    </div>
  );
}
