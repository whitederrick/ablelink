"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Filter } from "lucide-react";

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
  const [expanded, setExpanded] = useState<string|null>(null);

  function load(action=""){
    setLoading(true);
    fetch(`/api/admin/system/logs?action=${encodeURIComponent(action)}&limit=100`)
      .then(r=>r.json()).then(d=>{if(d.success)setLogs(d.logs);}).catch(()=>{}).finally(()=>setLoading(false));
  }

  useEffect(()=>{load();},[]);

  function prettyDetail(d: string|null){
    if(!d) return null;
    try { return JSON.stringify(JSON.parse(d),null,2); } catch { return d; }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-xl font-black text-slate-900">감사 로그</h1>
          <p className="mt-0.5 text-sm text-slate-500">시스템 운영자의 모든 데이터 변경 이력</p></div>
        <button onClick={()=>load(filter)} className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 active:scale-95">
          <RefreshCw className="h-4 w-4"/>새로고침
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
          <select value={filter} onChange={e=>{setFilter(e.target.value);load(e.target.value);}}
            className="rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400">
            <option value="">전체 액션</option>
            <option value="AGENCY">에이전시 관련</option>
            <option value="WORKER">직무지도원 관련</option>
            <option value="ATTENDANCE">출근 기록 수정</option>
            <option value="ADMIN">계정 관련</option>
          </select>
        </div>
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):logs.length===0?(
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">감사 로그가 없습니다.</p>
        </div>
      ):(
        <div className="space-y-1.5">
          {logs.map(l=>(
            <div key={l.id} className="rounded-xl border border-slate-100 bg-white">
              <button onClick={()=>setExpanded(expanded===l.id?null:l.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className={`flex-shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-black whitespace-nowrap ${ACTION_COLORS[l.action]??"bg-slate-100 text-slate-600"}`}>
                  {l.action}
                </span>
                <span className="flex-1 text-sm font-semibold text-slate-700 truncate">
                  {l.target??""} {l.adminLogin?`· ${l.adminLogin}`:""}
                </span>
                <span className="flex-shrink-0 text-xs text-slate-400">
                  {new Date(l.createdAt).toLocaleString("ko-KR")}
                </span>
              </button>
              {expanded===l.id&&l.detail&&(
                <div className="border-t border-slate-100 px-4 pb-3 pt-2">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">상세 정보</p>
                  <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs font-mono text-slate-700">
                    {prettyDetail(l.detail)}
                  </pre>
                  {l.ipAddress&&<p className="mt-1 text-[10px] text-slate-400">IP: {l.ipAddress}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
