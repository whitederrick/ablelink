"use client";

import { useEffect, useMemo, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  TRAINING:  { label: "훈련중",    tone: "sky" },
  EMPLOYED:  { label: "취업",      tone: "emerald" },
  DROPOUT:   { label: "중도포기",  tone: "rose" },
  GRADUATED: { label: "수료",      tone: "slate" },
};
const PAGE_SIZE = 10;

function ScoreBar({ value, max = 5 }: { value: number | null; max?: number }) {
  if (value === null) return <span className="text-xs font-semibold text-slate-300">-</span>;
  const pct = Math.round((value / max) * 100);
  const color =
    pct >= 80 ? "bg-emerald-400" :
    pct >= 60 ? "bg-sky-400" :
    pct >= 40 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-black text-slate-700">{value}</span>
    </div>
  );
}

function RateBar({ value }: { value: number }) {
  const color =
    value >= 90 ? "bg-emerald-400" :
    value >= 70 ? "bg-sky-400" :
    value >= 50 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 flex-shrink-0 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-black text-slate-700">{value}%</span>
    </div>
  );
}

interface TraineeRow {
  traineeId: string; traineeName: string; gender: string; disabilityType: string;
  status: string; workerName: string; siteName: string;
  totalWorkDays: number; daysWithLog: number; logRate: number;
  avgScore: number | null;
  evalType: string | null; evalPeriod: string | null; evalAvg: number | null;
  evalUpdatedAt: string | null;
}

function getThisYearMonth() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export default function TraineeReportPage() {
  const def = getThisYearMonth();
  const [year,    setYear]    = useState(def.year);
  const [month,   setMonth]   = useState(def.month);
  const [data,    setData]    = useState<TraineeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page,    setPage]    = useState(1);

  async function load(y: number, m: number) {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/trainee-report?year=${y}&month=${m}`, { headers: { "x-admin-context": "1" } });
      const d = await r.json();
      if (!d.success) { setError(d.message || "오류"); setData([]); return; }
      setData(d.data);
    } catch { setError("네트워크 오류"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(year, month); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => data
    .filter(r => statusFilter.length === 0 || statusFilter.includes(r.status))
    .filter(r =>
      !search ||
      r.traineeName.includes(search) ||
      r.workerName.includes(search) ||
      r.siteName.includes(search)
    ), [data, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const statusCount = (s: string) => data.filter(r => r.status === s).length;
  const filters: FilterChip[] = [
    { value: "TRAINING",  label: "훈련중",   count: statusCount("TRAINING") },
    { value: "EMPLOYED",  label: "취업",     count: statusCount("EMPLOYED") },
    { value: "DROPOUT",   label: "중도포기", count: statusCount("DROPOUT") },
    { value: "GRADUATED", label: "수료",     count: statusCount("GRADUATED") },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  const avgLogRate = filtered.length > 0
    ? Math.round(filtered.reduce((s, r) => s + r.logRate, 0) / filtered.length)
    : 0;
  const avgScore = (() => {
    const scored = filtered.filter(r => r.avgScore !== null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, r) => s + r.avgScore!, 0) / scored.length * 10) / 10;
  })();
  const trainingCount = filtered.filter(r => r.status === "TRAINING").length;

  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const yearOptions  = [2025, 2026, 2027];

  return (
    <div className="space-y-5">
      <PageHeader
        title="훈련생 진척도 리포트"
        sub="훈련생별 출근 일지 작성률과 수행 점수를 월별로 확인합니다."
      />

      <StatCardRow
        cols={4}
        items={[
          { label: "전체 훈련생", value: filtered.length },
          { label: "훈련 중", value: trainingCount, tone: "sky" },
          { label: "평균 일지 작성률", value: `${avgLogRate}%`, tone: avgLogRate >= 80 ? "emerald" : avgLogRate >= 60 ? "amber" : "rose" },
          { label: "평균 수행 점수 (/5)", value: avgScore ?? "-", tone: avgScore === null ? "slate" : avgScore >= 4 ? "emerald" : avgScore >= 3 ? "sky" : "amber" },
        ]}
      />

      <ListToolbar
        query={search}
        onQueryChange={setSearch}
        placeholder="훈련생·직무지도원·현장(사업체) 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
        extraFirst
        extra={
          <>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className={`w-auto ${T.select}`}>
              {yearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className={`w-auto ${T.select}`}>
              {monthOptions.map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
            <button onClick={() => load(year, month)} disabled={loading} className={T.btnPrimary}>
              {loading ? "조회 중..." : "조회"}
            </button>
          </>
        }
      />

      {/* 에러 */}
      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {/* 테이블 — 셀 1줄·고정폭(table-fixed+colgroup), 성명/성별·현장/직무지도원 별도 셀 */}
      {!error && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1080px] table-fixed border-collapse">
            <colgroup>
              <col className="w-[110px]" />{/* 훈련생 성명 */}
              <col className="w-[60px]" />{/* 성별 */}
              <col className="w-[100px]" />{/* 장애유형 */}
              <col className="w-[84px]" />{/* 상태 */}
              <col className="w-[150px]" />{/* 현장(사업체) */}
              <col className="w-[110px]" />{/* 직무지도원 */}
              <col className="w-[76px]" />{/* 출근일 */}
              <col className="w-[80px]" />{/* 일지작성 */}
              <col className="w-[130px]" />{/* 작성률 */}
              <col className="w-[120px]" />{/* 수행점수 */}
              <col className="w-[140px]" />{/* 종합평가 */}
            </colgroup>
            <thead>
              <tr>
                {["훈련생 성명", "성별", "장애유형", "상태", "현장(사업체)", "직무지도원", "출근일", "일지작성", "작성률", "수행점수(평균)", "종합평가"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className={T.tdCenter}>조회 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className={T.tdCenter}>데이터가 없습니다.</td></tr>
              ) : pageItems.map(row => (
                <tr key={row.traineeId} className={T.trBase}>
                  <td className={`${T.td} truncate font-black text-slate-900`}>{row.traineeName}</td>
                  <td className={T.td}>{row.gender === "M" ? "남" : "여"}</td>
                  <td className={`${T.td} truncate text-slate-600`}>{row.disabilityType}</td>
                  <td className={T.td}>
                    <StatusBadge status={row.status} map={STATUS_BADGE} />
                  </td>
                  <td className={`${T.td} truncate font-semibold text-slate-800`}>{row.siteName}</td>
                  <td className={`${T.td} truncate text-slate-600`}>{row.workerName}</td>
                  <td className={`${T.td} text-center`}>{row.totalWorkDays}일</td>
                  <td className={`${T.td} text-center`}>{row.daysWithLog}일</td>
                  <td className={T.td}>
                    <RateBar value={row.logRate} />
                  </td>
                  <td className={T.td}>
                    <ScoreBar value={row.avgScore} />
                  </td>
                  <td className={T.td}>
                    {row.evalAvg !== null ? (
                      <div className="flex items-center gap-1.5">
                        <ScoreBar value={row.evalAvg} />
                        <span className="text-[10px] font-semibold text-slate-400">{row.evalType === "TRAINING" ? "훈련" : "적응"}</span>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-slate-300">미작성</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 0 && (
            <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
          )}
        </div>
      )}
    </div>
  );
}
