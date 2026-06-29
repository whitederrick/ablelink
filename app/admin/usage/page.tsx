"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";

const PAGE_SIZE = 10;

const SERVICE_LABELS: Record<string, string> = {
  GROQ_STT:    "Groq STT",
  GEMINI_LOG:  "Gemini 일지",
  GEMINI_BATCH:"Gemini 배치",
};
const SERVICE_COLORS: Record<string, string> = {
  GROQ_STT:    "bg-sky-100 text-sky-700",
  GEMINI_LOG:  "bg-amber-100 text-amber-700",
  GEMINI_BATCH:"bg-emerald-100 text-emerald-700",
};

type PerAgency = Record<string, { name: string; calls: Record<string, number> }>;

type UsageDetail = {
  agencyName: string; total: number; totals: Record<string, number>;
  daily: { date: string; count: number }[];
  byWorker: { workerName: string; count: number }[];
};

function UsageDetailModal({ agencyId, ym, onClose }: { agencyId: string; ym: string; onClose: () => void }) {
  const [d, setD] = useState<UsageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/system/usage/${agencyId}?yearMonth=${ym}`)
      .then(r => r.json()).then(res => { if (res.success) setD(res); }).finally(() => setLoading(false));
  }, [agencyId, ym]);

  const maxDay = d ? Math.max(1, ...d.daily.map(x => x.count)) : 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900">{d?.agencyName ?? "AI 사용 상세"}</h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">{fmtYM(ym)} · 총 {(d?.total ?? 0).toLocaleString()}회</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50">✕</button>
        </div>
        {loading ? <p className="py-10 text-center text-sm font-semibold text-slate-400">불러오는 중...</p> : !d ? <p className="py-10 text-center text-sm font-semibold text-slate-400">불러올 수 없습니다.</p> : (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* 서비스별 */}
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(SERVICE_LABELS).map(([k, label]) => (
                <div key={k} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-3 text-center">
                  <p className="text-[11px] font-semibold text-slate-400">{label}</p>
                  <p className="mt-1 text-lg font-black text-slate-900 tabular-nums">{(d.totals[k] ?? 0).toLocaleString()}</p>
                </div>
              ))}
            </div>
            {/* 일자별 추이 */}
            <div>
              <p className="mb-1.5 text-sm font-black text-slate-700">일자별 호출</p>
              {d.daily.length === 0 ? <p className="text-xs text-slate-400">기록 없음</p> : (
                <div className="space-y-1">
                  {d.daily.map(x => (
                    <div key={x.date} className="flex items-center gap-2">
                      <span className="w-[88px] flex-shrink-0 text-[12px] tabular-nums text-slate-500">{x.date.slice(5)}</span>
                      <span className="h-3 rounded bg-sky-400" style={{ width: `${Math.max(4, (x.count / maxDay) * 100)}%` }} />
                      <span className="text-[12px] font-black tabular-nums text-slate-600">{x.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* 직무지도원별 */}
            <div>
              <p className="mb-1.5 text-sm font-black text-slate-700">직무지도원별 호출</p>
              {d.byWorker.length === 0 ? <p className="text-xs text-slate-400">기록 없음</p> : (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {d.byWorker.map((w, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-slate-50 px-3 py-2 last:border-b-0">
                      <span className="text-[13px] font-semibold text-slate-700">{w.workerName}</span>
                      <span className="text-[13px] font-black tabular-nums text-sky-700">{w.count.toLocaleString()}회</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3"><button onClick={onClose} className={T.btnSecondary}>닫기</button></div>
      </div>
    </div>
  );
}

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
  const [detailId, setDetailId] = useState<string | null>(null);

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
        sub="월별·위탁기관별 AI API 호출량을 확인합니다."
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
        <ListToolbar query={q} onQueryChange={setQ} placeholder="위탁기관명 검색" />
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
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[220px]" />{/* 위탁기관 */}
              <col className="w-[130px]" />{/* Groq STT */}
              <col className="w-[130px]" />{/* Gemini 일지 */}
              <col className="w-[130px]" />{/* Gemini 배치 */}
              <col className="w-[110px]" />{/* 합계 */}
            </colgroup>
            <thead>
              <tr>
                <th className={T.th}>위탁기관</th>
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
                    <tr key={id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(id)}>
                      <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{ag.name}</span></td>
                      {Object.keys(SERVICE_LABELS).map(key => (
                        <td key={key} className={T.td + " tabular-nums"}>
                          {ag.calls[key] != null ? (
                            <span className={`${T.badge} ${SERVICE_COLORS[key] ?? "bg-slate-100 text-slate-600"}`}>
                              {ag.calls[key].toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                      ))}
                      <td className={T.td + " tabular-nums font-black text-slate-900"}>
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

      {detailId && <UsageDetailModal agencyId={detailId} ym={ym} onClose={() => setDetailId(null)} />}
    </div>
  );
}
