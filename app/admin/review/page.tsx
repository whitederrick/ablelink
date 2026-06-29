"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import { StatCardRow } from "../_components/StatCard";

const PAGE_SIZE = 10;

type C = { total: number; confirmed: number };
type UrgentWorker = { workerId: string; workerName: string; phoneNumber: string; siteName: string; att: C; log: C };
type Agency = {
  agencyId: string; agencyName: string; workerCount: number;
  att: C; log: C; urgent: UrgentWorker[];
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function nowYM() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }

function Rate({ c }: { c: C }) {
  if (c.total === 0) return <span className="text-xs font-semibold text-slate-300">기록 없음</span>;
  const pct = Math.round((c.confirmed / c.total) * 100);
  const done = c.confirmed >= c.total;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`text-sm font-black ${done ? "text-emerald-600" : "text-amber-600"}`}>{pct}%</span>
      <span className="text-[13px] text-slate-400">({c.confirmed}/{c.total})</span>
    </span>
  );
}

export default function AdminReviewPage() {
  const [yearMonth, setYearMonth] = useState(nowYM());
  const [agencies, setAgencies]   = useState<Agency[]>([]);
  const [loading, setLoading]     = useState(false);
  const [search, setSearch]       = useState("");
  const [urgentOnly, setUrgentOnly] = useState<string[]>([]);
  const [page, setPage]           = useState(1);
  const [detail, setDetail]       = useState<Agency | null>(null);
  const [remindMsg, setRemindMsg] = useState("");
  const [sending, setSending]     = useState(false);
  const [toast, setToast]         = useState("");

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(""), 2800); }

  function changeMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/review?yearMonth=${yearMonth}`, { headers: { "x-admin-context": "1" } })
      .then(r => r.json())
      .then(d => { if (d.success) setAgencies(d.agencies); })
      .finally(() => setLoading(false));
  }, [yearMonth]);

  const totalUrgentWorkers = agencies.reduce((s, a) => s + a.urgent.length, 0);
  const urgentAgencies = agencies.filter(a => a.urgent.length > 0).length;

  const filtered = useMemo(() => {
    const q = search.trim();
    return agencies
      .filter(a => urgentOnly.length === 0 || a.urgent.length > 0)
      .filter(a => !q || a.agencyName.includes(q));
  }, [agencies, search, urgentOnly]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [search, urgentOnly, yearMonth]);

  function openDetail(a: Agency) { setDetail(a); setRemindMsg(""); }

  async function sendRemind() {
    if (!detail) return;
    setSending(true);
    const res = await fetch("/api/admin/review/remind", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-context": "1" },
      body: JSON.stringify({ agencyId: detail.agencyId, yearMonth, message: remindMsg.trim() || undefined }),
    });
    const data = await res.json();
    setSending(false);
    if (data.success) { const n = detail.agencyName; setDetail(null); showToast(`${n} 담당자에게 독려 알림을 발송했습니다. (${data.sent}명)`); }
    else showToast(data.message || "발송 실패");
  }

  const filters: FilterChip[] = [{ value: "URGENT", label: "독려 필요", count: urgentAgencies }];
  const COLS = ["위탁기관", "직무지도원 수", "출근부 마감률", "일지 마감률", "독려 필요(종료자 미완료)", "담당자 독려"];

  return (
    <div className="space-y-5">
      <PageHeader
        title="월별 진척도 현황 관리"
        sub="전체 위탁기관의 월별 마감 진척을 기관 단위로 모니터링하고, 근무 종료 직무지도원의 미완료 건은 담당자에게 독려합니다."
        actions={
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
            <button onClick={() => changeMonth(-1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[80px] text-center text-sm font-black text-slate-900">{yearMonth.replace("-", "년 ")}월</span>
            <button onClick={() => changeMonth(1)} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
          </div>
        }
      />

      <StatCardRow
        cols={3}
        items={[
          { label: "위탁기관", value: agencies.length },
          { label: "독려 필요 기관", value: urgentAgencies, tone: "amber" },
          { label: "독려 필요 직무지도원", value: totalUrgentWorkers, tone: "rose" },
        ]}
      />

      <ListToolbar
        query={search}
        onQueryChange={setSearch}
        placeholder="위탁기관 검색"
        filters={filters}
        selected={urgentOnly}
        onToggleFilter={(v) => setUrgentOnly(p => p.includes(v) ? p.filter(x => x !== v) : [v])}
      />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[940px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[200px]" />{/* 위탁기관 */}
            <col className="w-[110px]" />{/* 직무지도원 수 */}
            <col className="w-[160px]" />{/* 출근부 마감률 */}
            <col className="w-[160px]" />{/* 일지 마감률 */}
            <col className="w-[180px]" />{/* 독려 필요 */}
            <col className="w-[120px]" />{/* 담당자 독려 */}
          </colgroup>
          <thead>
            <tr>{COLS.map(h => <th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLS.length} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={COLS.length} className={T.tdCenter}>{agencies.length === 0 ? "해당 기간에 데이터가 없습니다." : "조건에 맞는 기관이 없습니다."}</td></tr>
            ) : pageItems.map(a => (
              <tr key={a.agencyId} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => openDetail(a)}>
                <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{a.agencyName}</span></td>
                <td className={T.td}>{a.workerCount}명</td>
                <td className={T.td}><Rate c={a.att} /></td>
                <td className={T.td}><Rate c={a.log} /></td>
                <td className={T.td}>
                  {a.urgent.length > 0
                    ? <span className={`${T.badge} bg-rose-50 text-rose-600`}>{a.urgent.length}명</span>
                    : <span className="text-[13px] text-slate-400">없음</span>}
                </td>
                <td className={T.td}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDetail(a); }}
                    disabled={a.urgent.length === 0}
                    className={a.urgent.length > 0
                      ? "inline-flex items-center justify-center min-h-9 rounded-xl border border-rose-200 bg-white px-3 text-sm font-bold text-rose-600 transition hover:bg-rose-50 active:scale-95"
                      : "inline-flex items-center justify-center min-h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-300"}>
                    독려
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold leading-relaxed text-slate-500">
          · 마감률 = 확정/전체. 직무지도원이 직접 확정한 기록만 집계됩니다.<br />
          · <b className="text-rose-500">독려 필요</b> = 해당 월에 근무가 종료되는 직무지도원 중 출근부·일지가 미확정인 경우만 (진행 중 직무지도원은 제외).<br />
          · 독려는 해당 위탁기관 담당자에게 앱 알림으로 발송됩니다. (실제 수정·확정은 담당자가 처리)
        </p>
      </div>

      {/* 기관 상세 + 독려 모달 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900">{detail.agencyName}</h2>
              <span className={`${T.badge} bg-slate-100 text-slate-500`}>{yearMonth.replace("-", "년 ")}월</span>
            </div>
            <p className="mb-4 text-[13px] font-semibold text-slate-400">
              직무지도원 {detail.workerCount}명 · 출근부 {detail.att.confirmed}/{detail.att.total} · 일지 {detail.log.confirmed}/{detail.log.total}
            </p>

            <p className="mb-2 text-sm font-black text-slate-700">독려 필요 — 근무 종료 직무지도원 미완료 ({detail.urgent.length})</p>
            {detail.urgent.length === 0 ? (
              <p className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-4 text-center text-sm font-semibold text-slate-400">독려가 필요한 종료 직무지도원이 없습니다.</p>
            ) : (
              <div className="space-y-1.5">
                {detail.urgent.map(u => (
                  <div key={u.workerId} className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/40 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">{u.workerName} <span className="font-medium text-slate-400">· {u.siteName}</span></p>
                      <p className="text-[12px] font-semibold text-slate-500">출근부 {u.att.confirmed}/{u.att.total} · 일지 {u.log.confirmed}/{u.log.total}</p>
                    </div>
                    <span className="shrink-0 text-[12px] text-slate-400">{u.phoneNumber || ""}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5">
              <label className="mb-1 block text-xs font-black text-slate-700">담당자 독려 메시지 (선택)</label>
              <textarea
                value={remindMsg}
                onChange={e => setRemindMsg(e.target.value)}
                placeholder="비우면 기본 안내 문구로 발송됩니다."
                rows={3}
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100"
              />
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button onClick={() => setDetail(null)} className={T.btnSecondary}>닫기</button>
              <button onClick={sendRemind} disabled={sending || detail.urgent.length === 0} className={T.btnPrimary}>
                {sending ? "발송 중..." : "담당자에게 독려 발송"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>
      )}
    </div>
  );
}
