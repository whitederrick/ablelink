"use client";

import { useEffect, useState } from "react";
import { T } from "../_styles";

const STATUS_LABELS: Record<string, string> = {
  TRAINING: "훈련중", EMPLOYED: "취업", DROPOUT: "중도포기", GRADUATED: "수료",
};
const STATUS_COLORS: Record<string, string> = {
  TRAINING: "bg-sky-50 text-sky-700",
  EMPLOYED: "bg-emerald-50 text-emerald-700",
  DROPOUT:  "bg-rose-50 text-rose-700",
  GRADUATED:"bg-slate-100 text-slate-500",
};

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

  async function load(y: number, m: number) {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/trainee-report?year=${y}&month=${m}`);
      const d = await r.json();
      if (!d.success) { setError(d.message || "오류"); setData([]); return; }
      setData(d.data);
    } catch { setError("네트워크 오류"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(year, month); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = data.filter(r =>
    !search ||
    r.traineeName.includes(search) ||
    r.workerName.includes(search) ||
    r.siteName.includes(search)
  );

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
      <div>
        <h1 className={T.pageTitle}>훈련생 진척도 리포트</h1>
        <p className={T.pageSub}>훈련생별 출근 일지 작성률과 수행 점수를 월별로 확인합니다. (STANDARD+)</p>
      </div>

      {/* 검색/기간 필터 */}
      <div className={`${T.card} flex flex-wrap items-center gap-3`}>
        <select value={year} onChange={e => setYear(Number(e.target.value))} className={`w-auto ${T.select}`}>
          {yearOptions.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
        <select value={month} onChange={e => setMonth(Number(e.target.value))} className={`w-auto ${T.select}`}>
          {monthOptions.map(m => <option key={m} value={m}>{m}월</option>)}
        </select>
        <button
          onClick={() => load(year, month)}
          disabled={loading}
          className={T.btnPrimary}
        >
          {loading ? "조회 중..." : "조회"}
        </button>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="훈련생·직무지도원·사업장 검색"
          className={`ml-auto w-64 ${T.input}`}
        />
      </div>

      {/* 요약 카드 */}
      <div className={T.summaryGrid}>
        <div className={T.summaryCard}>
          <p className={`${T.summaryNum} text-slate-900`}>{filtered.length}</p>
          <p className={T.summaryLabel}>전체 훈련생</p>
        </div>
        <div className={T.summaryCard}>
          <p className={`${T.summaryNum} text-sky-600`}>{trainingCount}</p>
          <p className={T.summaryLabel}>훈련 중</p>
        </div>
        <div className={T.summaryCard}>
          <p className={`${T.summaryNum} ${avgLogRate >= 80 ? "text-emerald-600" : avgLogRate >= 60 ? "text-amber-500" : "text-rose-500"}`}>
            {avgLogRate}%
          </p>
          <p className={T.summaryLabel}>평균 일지 작성률</p>
        </div>
        <div className={T.summaryCard}>
          <p className={`${T.summaryNum} ${avgScore === null ? "text-slate-300" : avgScore >= 4 ? "text-emerald-600" : avgScore >= 3 ? "text-sky-600" : "text-amber-500"}`}>
            {avgScore ?? "-"}
          </p>
          <p className={T.summaryLabel}>평균 수행 점수 (/5)</p>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {/* 테이블 */}
      {!error && (
        <div className={T.tableWrap}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {["훈련생", "장애유형", "상태", "사업장 / 직무지도원", "출근일", "일지작성", "작성률", "수행점수 (평균)", "종합평가"].map(h => (
                  <th key={h} className={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className={T.tdCenter}>조회 중...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className={T.tdCenter}>데이터가 없습니다.</td></tr>
              ) : filtered.map(row => (
                <tr key={row.traineeId} className={T.trBase}>
                  <td className={T.td}>
                    <p className="font-black text-slate-900">{row.traineeName}</p>
                    <p className="text-xs font-semibold text-slate-400">{row.gender === "M" ? "남" : "여"}</p>
                  </td>
                  <td className={T.td}>
                    <span className="text-xs font-semibold text-slate-600">{row.disabilityType}</span>
                  </td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${STATUS_COLORS[row.status] || "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                  </td>
                  <td className={T.td}>
                    <p className="font-semibold text-slate-800">{row.siteName}</p>
                    <p className="text-xs font-semibold text-slate-400">{row.workerName}</p>
                  </td>
                  <td className={`${T.td} text-center font-black`}>
                    {row.totalWorkDays}일
                  </td>
                  <td className={`${T.td} text-center font-black`}>
                    {row.daysWithLog}일
                  </td>
                  <td className={T.td}>
                    <RateBar value={row.logRate} />
                  </td>
                  <td className={T.td}>
                    <ScoreBar value={row.avgScore} />
                  </td>
                  <td className={T.td}>
                    {row.evalAvg !== null ? (
                      <div>
                        <ScoreBar value={row.evalAvg} />
                        <p className="mt-1 text-[10px] font-semibold text-slate-400">
                          {row.evalType === "TRAINING" ? "훈련" : "적응"} · {row.evalPeriod}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs font-semibold text-slate-300">미작성</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
