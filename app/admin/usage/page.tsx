"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { T } from "../_styles";

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

  const services = Object.keys(totals);
  const agencyRows = Object.entries(perAgency);
  const totalCalls = Object.values(totals).reduce((a, b) => a + b, 0);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={T.pageTitle}>AI 사용량</h1>
          <p className={T.pageSub}>월별·에이전시별 AI API 호출 통계</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYm(prevMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[90px] text-center text-sm font-black text-slate-900">{fmtYM(ym)}</span>
          <button onClick={() => setYm(nextMonth(ym))} className={T.btnSecondary + " px-2.5"}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => load(ym)} className={T.btnSecondary + " flex items-center gap-1.5"}><RefreshCw className="h-4 w-4" /></button>
        </div>
      </div>

      {/* 전체 합계 */}
      <div className="mb-5 grid grid-cols-4 gap-3.5">
        <div className={T.summaryCard}>
          <p className={T.summaryNum + " text-slate-900"}>{totalCalls.toLocaleString()}</p>
          <p className={T.summaryLabel}>총 호출</p>
        </div>
        {Object.entries(SERVICE_LABELS).map(([key, label]) => (
          <div key={key} className={T.summaryCard}>
            <p className={T.summaryNum + " text-slate-900"}>{(totals[key] ?? 0).toLocaleString()}</p>
            <p className={T.summaryLabel}>{label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : agencyRows.length === 0 ? (
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
              {agencyRows
                .sort((a, b) => {
                  const sumA = Object.values(a[1].calls).reduce((x, y) => x + y, 0);
                  const sumB = Object.values(b[1].calls).reduce((x, y) => x + y, 0);
                  return sumB - sumA;
                })
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
        </div>
      )}
    </div>
  );
}
