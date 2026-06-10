"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";

const PAGE_SIZE = 10;

type AuditLog = {
  id: string; action: string; target: string|null; detail: string|null;
  adminId: string|null; adminLogin: string|null; adminName: string|null;
  ipAddress: string|null; createdAt: string;
};

const ACTION_COLORS: Record<string,string> = {
  AGENCY_CREATED:"bg-emerald-100 text-emerald-700",
  AGENCY_PLAN_CHANGED:"bg-sky-100 text-sky-700",
  WORKER_PASSWORD_RESET:"bg-amber-100 text-amber-700",
  WORKER_STATUS_CHANGED:"bg-rose-100 text-rose-700",
  ATTENDANCE_CORRECTED:"bg-violet-100 text-violet-700",
  ADMIN_CREATED:"bg-slate-100 text-slate-700",
};

export default function LogsPage() {
  const [logs, setLogs]     = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [query, setQuery]   = useState("");
  const [page, setPage]     = useState(1);
  const [detail, setDetail] = useState<AuditLog|null>(null);

  function load(action=""){
    setLoading(true);
    fetch(`/api/admin/system/logs?action=${encodeURIComponent(action)}&limit=200`)
      .then(r=>r.json()).then(d=>{if(d.success)setLogs(d.logs);}).catch(()=>{}).finally(()=>setLoading(false));
  }

  useEffect(()=>{load();},[]);

  const filtered = useMemo(()=>{
    const q = query.trim().toLowerCase();
    return logs.filter(l => !q || l.action.toLowerCase().includes(q) || (l.target??"").toLowerCase().includes(q) || (l.adminLogin??"").toLowerCase().includes(q));
  },[logs,query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
  const pageItems = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  useEffect(()=>{setPage(1);},[query,filter]);

  function prettyDetail(d: string|null){
    if(!d) return null;
    try { return JSON.stringify(JSON.parse(d),null,2); } catch { return d; }
  }

  return (
    <div>
      <PageHeader title="감사 로그" sub="시스템 운영자의 모든 데이터 변경 이력을 조회합니다." />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={setQuery}
          placeholder="액션·대상·계정 검색"
          extra={
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
              <select value={filter} onChange={e=>{setFilter(e.target.value);load(e.target.value);}}
                className="h-10 rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400">
                <option value="">전체 액션</option>
                <option value="AGENCY">에이전시 관련</option>
                <option value="WORKER">직무지도원 관련</option>
                <option value="ATTENDANCE">출근 기록 수정</option>
                <option value="ADMIN">계정 관련</option>
              </select>
            </div>
          }
        />
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className={T.tableWrap}>
          <table className="w-full">
            <thead>
              <tr>
                <th className={T.th}>액션</th>
                <th className={T.th}>대상</th>
                <th className={T.th}>계정</th>
                <th className={T.th}>일시</th>
                <th className={T.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length===0?(
                <tr><td colSpan={5} className={T.empty}>{logs.length===0?"감사 로그가 없습니다.":"조건에 맞는 로그가 없습니다."}</td></tr>
              ):pageItems.map(l=>(
                <tr key={l.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={()=>setDetail(l)}>
                  <td className={T.td}>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black whitespace-nowrap ${ACTION_COLORS[l.action]??"bg-slate-100 text-slate-600"}`}>{l.action}</span>
                  </td>
                  <td className={`${T.td} max-w-[260px] truncate`}>{l.target??<span className="text-slate-300">-</span>}</td>
                  <td className={T.td}>{l.adminLogin??<span className="text-slate-300">-</span>}{l.adminName?<span className="text-[13px] text-slate-500"> ({l.adminName})</span>:""}</td>
                  <td className={`${T.td} whitespace-nowrap text-[13px] text-slate-500`}>{new Date(l.createdAt).toLocaleString("ko-KR")}</td>
                  <td className={T.td}><span className="text-[13px] font-semibold text-sky-600">상세</span></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </div>
      )}

      {/* 상세 모달 */}
      {detail && (
        <div className={T.modalOverlay} onClick={()=>setDetail(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${ACTION_COLORS[detail.action]??"bg-slate-100 text-slate-600"}`}>{detail.action}</span>
                <p className="mt-2 text-[13px] font-semibold text-slate-400">{new Date(detail.createdAt).toLocaleString("ko-KR")}</p>
              </div>
              <button onClick={()=>setDetail(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5"/></button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-2">
                <span className="text-[13px] font-semibold text-slate-400">대상</span>
                <span className="font-semibold text-slate-800">{detail.target??"-"}</span>
                <span className="text-[13px] font-semibold text-slate-400">계정</span>
                <span className="font-semibold text-slate-800">{detail.adminLogin??"-"}{detail.adminName?` (${detail.adminName})`:""}</span>
                {detail.ipAddress && <><span className="text-[13px] font-semibold text-slate-400">IP</span><span className="font-semibold text-slate-800">{detail.ipAddress}</span></>}
              </div>
              {detail.detail && (
                <div>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">상세 정보</p>
                  <pre className="max-h-[50vh] overflow-auto rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-700">{prettyDetail(detail.detail)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
