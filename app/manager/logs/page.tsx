"use client";

// 훈련 일지 열람 — 표준 게시판: PageHeader(CSV) → StatCardRow → ListToolbar(검색 + 상태필터 + 월/직무지도원) → 목록(클릭 펼침 상세) → Pagination.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download } from "lucide-react";
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
const LOG_PAGE_SIZE = 12;

function nowYM() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

export default function ManagerLogsPage() {
  const [logs, setLogs]       = useState<Log[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandId, setExpandId] = useState<string|null>(null);

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
        <div className="space-y-2">
          {pageItems.map(l=>(
            <div key={l.id} className={`rounded-2xl border bg-white ${l.isCompleted?"border-emerald-100":"border-slate-100"}`}>
              <button onClick={()=>setExpandId(expandId===l.id?null:l.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <div className="flex flex-1 min-w-0 items-center gap-2">
                  <span className="shrink-0 text-[15px] font-black text-slate-900">
                    {l.workDate} ({DOW[new Date(l.workDate+"T00:00:00").getDay()]})
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-slate-600">{l.workerName}</span>
                  <span className="shrink-0 text-sm text-slate-400">→ {l.traineeName}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{TYPE_LABELS[l.trainingType]??l.trainingType}</span>
                  <StatusBadge status={l.isCompleted?"confirmed":"pending"} map={LOG_BADGE} />
                  <span className="truncate text-xs text-slate-400">
                    {l.siteName} · {l.totalTime}h · {l.attendance}{l.taskName?` · ${l.taskName}`:""}
                  </span>
                </div>
                {expandId===l.id?<ChevronUp className="h-4 w-4 text-slate-400 flex-shrink-0"/>:<ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0"/>}
              </button>
              {expandId===l.id&&(
                <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                  {l.content?(
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{l.content}</p>
                  ):(
                    <p className="text-sm text-slate-400 italic">내용 없음</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}
    </div>
  );
}
