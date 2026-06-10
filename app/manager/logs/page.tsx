"use client";

// 훈련 일지 열람 — 표준 게시판: PageHeader(CSV) → StatCardRow → ListToolbar(검색 + 상태필터 + 월/직무지도원) → 목록(클릭 펼침 상세) → Pagination.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Log = {
  id: string; traineeId: string; traineeName: string;
  writerId: string; workerName: string; siteName: string;
  workDate: string; trainingType: string; attendance: string;
  totalTime: number; content: string; taskName: string;
  taskScore: number | null; isCompleted: boolean;
};
type Worker = { id: string; workerName: string };

const TYPE_LABELS: Record<string,string> = { PRE:"사전훈련", FIELD:"현장훈련", ADAPTATION:"적응지도" };
const DOW = ["일","월","화","수","목","금","토"];
const LOG_BADGE = { confirmed: { label: "확정", tone: "emerald" as const }, pending: { label: "미확정", tone: "amber" as const } };
const LOG_PAGE_SIZE = 10;

function nowYM() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

export default function ManagerLogsPage() {
  const [logs, setLogs]       = useState<Log[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Log|null>(null);

  // 서버 조회조건(월·직무지도원)
  const [workerId, setWorkerId]   = useState("");
  const [ym, setYm]             = useState(nowYM());
  // 클라이언트 조회조건
  const [query, setQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(()=>{
    fetch("/api/admin/workers?pageSize=200")
      .then(r=>r.json())
      .then(d=>{ if(d.success) setWorkers(d.data?.map((c:any)=>({id:c.id,workerName:c.workerName}))||[]); });
  },[]);

  const load = useCallback(()=>{
    setLoading(true);
    const [y,m] = ym.split("-");
    const last  = new Date(Number(y), Number(m), 0).getDate();
    const params = new URLSearchParams({
      dateFrom:  `${ym}-01`,
      dateTo:    `${ym}-${String(last).padStart(2,"0")}`,
      ...(workerId   ? { workerId }   : {}),
    });
    fetch(`/api/admin/logs?${params}`)
      .then(r=>r.json())
      .then(d=>{ if(d.success) setLogs(d.logs); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[ym, workerId]);

  useEffect(()=>{ load(); },[load]);

  function exportCsv() {
    const [y,m] = ym.split("-");
    const last  = new Date(Number(y), Number(m), 0).getDate();
    window.open(`/api/admin/export/csv?type=logs&from=${ym}-01&to=${ym}-${String(last).padStart(2,"0")}`, "_blank");
  }

  const confirmed = logs.filter(l=>l.isCompleted).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs
      .filter(l => selectedStatus.length === 0 || selectedStatus.includes(l.isCompleted ? "confirmed" : "pending"))
      .filter(l => !q
        || (l.traineeName ?? "").toLowerCase().includes(q)
        || (l.workerName ?? "").toLowerCase().includes(q)
        || (l.content ?? "").toLowerCase().includes(q));
  }, [logs, query, selectedStatus]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LOG_PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);

  const filters: FilterChip[] = [
    { value: "confirmed", label: "확정", count: confirmed },
    { value: "pending", label: "미확정", count: logs.length - confirmed },
  ];
  const toggleStatus = (v: string) => { setPage(1); setSelectedStatus(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); };

  return (
    <div>
      <PageHeader
        title="훈련 일지 열람"
        sub="직무지도원이 작성한 훈련 일지를 확인합니다."
        actions={
          <button onClick={exportCsv} className={`${T.btnSecondary} flex items-center gap-1.5`}>
            <Download className="h-4 w-4"/>CSV 내보내기
          </button>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 일지", value: logs.length },
          { label: "확정", value: confirmed, tone: "emerald" },
          { label: "미확정", value: logs.length - confirmed, tone: "amber" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={v => { setQuery(v); setPage(1); }}
          placeholder="훈련생·작성자·내용 검색"
          filters={filters}
          selected={selectedStatus}
          onToggleFilter={toggleStatus}
          extra={
            <>
              <input type="month" value={ym} onChange={e=>{ setYm(e.target.value); setPage(1); }}
                className={T.input}/>
              <select value={workerId} onChange={e=>{ setWorkerId(e.target.value); setPage(1); }} className={T.select}>
                <option value="">전체 직무지도원</option>
                {workers.map(c=><option key={c.id} value={c.id}>{c.workerName}</option>)}
              </select>
            </>
          }
        />
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):logs.length===0?(
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">일지가 없습니다.</p>
        </div>
      ):pageItems.length===0?(
        <p className={T.empty}>조건에 맞는 일지가 없습니다.</p>
      ):(
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                {["날짜", "작성자 → 훈련생", "유형", "상태", "현장 · 시간 · 출결 · 과제", ""].map(h => <th key={h} className={T.th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {pageItems.map(l => (
                <tr key={l.id} onClick={() => setDetail(l)} className={`${T.trBase} cursor-pointer hover:bg-slate-50`}>
                  <td className={`${T.td} whitespace-nowrap`}>{l.workDate.slice(5)} ({DOW[new Date(l.workDate + "T00:00:00").getDay()]})</td>
                  <td className={T.td}>{l.workerName} <span className="text-slate-400">→</span> {l.traineeName}</td>
                  <td className={T.td}><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] font-semibold text-slate-600">{TYPE_LABELS[l.trainingType] ?? l.trainingType}</span></td>
                  <td className={T.td}><StatusBadge status={l.isCompleted ? "confirmed" : "pending"} map={LOG_BADGE} /></td>
                  <td className={`${T.td} max-w-[280px] truncate text-[13px] text-slate-500`}>{l.siteName} · {l.totalTime}h · {l.attendance}{l.taskName ? ` · ${l.taskName}` : ""}</td>
                  <td className={T.td}><span className="text-[13px] font-semibold text-sky-600">상세</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <Pagination className="mt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {/* 일지 상세 모달 */}
      {detail && (
        <div className={T.modalOverlay} onClick={()=>setDetail(null)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-3xl bg-white p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-base font-black text-slate-900">{detail.workerName} → {detail.traineeName}</p>
                  <StatusBadge status={detail.isCompleted?"confirmed":"pending"} map={LOG_BADGE} />
                </div>
                <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
                  {detail.workDate} ({DOW[new Date(detail.workDate+"T00:00:00").getDay()]}) · {TYPE_LABELS[detail.trainingType]??detail.trainingType} · {detail.siteName}
                </p>
              </div>
              <button onClick={()=>setDetail(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5"/></button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { l: "근무시간", v: `${detail.totalTime}h` },
                { l: "출결", v: detail.attendance },
                { l: "수행과제", v: detail.taskName || "-" },
                { l: "수행점수", v: detail.taskScore != null ? `${detail.taskScore}점` : "-" },
              ].map((x,i)=>(
                <div key={i} className="rounded-xl bg-slate-50 px-3 py-2 text-center">
                  <p className="text-[11px] font-semibold text-slate-400">{x.l}</p>
                  <p className="mt-0.5 text-sm font-black text-slate-800">{x.v}</p>
                </div>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-slate-400">일지 내용</p>
              {detail.content ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{detail.content}</p>
              ) : (
                <p className="text-sm italic text-slate-400">내용 없음</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
