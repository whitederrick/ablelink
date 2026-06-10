"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";

const PAGE_SIZE = 20;

const SERVICE_LABELS: Record<string, string> = {
  GROQ_STT:    "Groq STT",
  GEMINI_LOG:  "Gemini 일지",
  GEMINI_BATCH:"Gemini 배치",
};
const SERVICE_COLORS: Record<string, string> = {
  GROQ_STT:    "bg-sky-100 text-sky-700",
  GEMINI_LOG:  "bg-violet-100 text-violet-700",
  GEMINI_BATCH:"bg-emerald-100 text-emerald-700",
};

type PerAgency = Record<string, { name: string; calls: Record<string, number> }>;

function prevMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function nextMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function fmtYM(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

export default function UsagePage() {
  const today = new Date();
  const [ym, setYm] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);
  const [totals, setTotals]     = useState<Record<string, number>>({});
  const [perAgency, setPerAgency] = useState<PerAgency>({});
  const [loading, setLoading]   = useState(true);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  function load(yearMonth: string) {
    setLoading(true);
    fetch(`/api/admin/system/usage?yearMonth=${yearMonth}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setTotals(d.totals); setPerAgency(d.perAgency); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(ym); }, [ym]);

  const totalCalls = Object.values(totals).reduce((a, b) => a + b, 0);

  const sortedRows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return Object.entries(perAgency)
      .filter(([, ag]) => !query || ag.name.toLowerCase().includes(query))
      .sort((a, b) => {
        const sumA = Object.values(a[1].calls).reduce((x, y) => x + y, 0);
        const sumB = Object.values(b[1].calls).reduce((x, y) => x + y, 0);
        return sumB - sumA;
      });
  }, [perAgency, q]);
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [q, ym]);

  return (
    <div>
      <PageHeader
        title="AI 사용량"
        sub="월별·에이전시별 AI API 호출 통계"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setYm(prevMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[90px] text-center text-sm font-black text-slate-900">{fmtYM(ym)}</span>
            <button onClick={() => setYm(nextMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => load(ym)} className={T.btnSecondary + " flex items-center gap-1.5"}><RefreshCw className="h-4 w-4" /></button>
          </div>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "총 호출", value: totalCalls.toLocaleString() },
          ...Object.entries(SERVICE_LABELS).map(([key, label]) => ({ label, value: (totals[key] ?? 0).toLocaleString() })),
        ]}
      />

      <div className="mb-4">
        <ListToolbar query={q} onQueryChange={setQ} placeholder="에이전시명 검색" />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : sortedRows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">해당 월에 AI 사용 기록이 없습니다.</p>
        </div>
      ) : (
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={T.th}>에이전시</th>
                {Object.entries(SERVICE_LABELS).map(([key, label]) => (
                  <th key={key} className={T.th}>{label}</th>
                ))}
                <th className={T.th}>합계</th>
              </tr>
            </thead>
            <tbody>
              {pageRows
                .map(([id, ag]) => {
                  const sum = Object.values(ag.calls).reduce((a, b) => a + b, 0);
                  return (
                    <tr key={id} className={T.trBase}>
                      <td className={T.td + " font-semibold text-slate-900"}>{ag.name}</td>
                      {Object.keys(SERVICE_LABELS).map(key => (
                        <td key={key} className={T.td + " tabular-nums text-right"}>
                          {ag.calls[key] != null ? (
                            <span className={`${T.badge} ${SERVICE_COLORS[key] ?? "bg-slate-100 text-slate-600"}`}>
                              {ag.calls[key].toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      ))}
                      <td className={T.td + " font-black text-slate-900 tabular-nums text-right"}>
                        {sum.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={sortedRows.length} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
