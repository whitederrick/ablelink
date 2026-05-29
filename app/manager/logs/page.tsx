"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, ChevronDown, ChevronUp, Download } from "lucide-react";

type Log = {
  id: string; traineeId: string; traineeName: string;
  writerId: string; coachName: string; siteName: string;
  workDate: string; trainingType: string; attendance: string;
  totalTime: number; content: string; taskName: string;
  taskScore: number | null; isCompleted: boolean;
};
type Worker = { id: string; userName: string };

const TYPE_LABELS: Record<string,string> = { PRE:"사전훈련", FIELD:"현장훈련", ADAPTATION:"적응지도" };
const DOW = ["일","월","화","수","목","금","토"];

function nowYM() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }

export default function ManagerLogsPage() {
  const [logs, setLogs]       = useState<Log[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandId, setExpandId] = useState<string|null>(null);
  const [coachId, setCoachId]   = useState("");
  const [completed, setCompleted] = useState("");
  const [ym, setYm]             = useState(nowYM());
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),2500); };

  useEffect(()=>{
    fetch("/api/admin/workers?pageSize=200")
      .then(r=>r.json())
      .then(d=>{ if(d.success) setWorkers(d.data?.map((c:any)=>({id:c.id,userName:c.userName}))||[]); });
  },[]);

  const load = useCallback(()=>{
    setLoading(true);
    const [y,m] = ym.split("-");
    const last  = new Date(Number(y), Number(m), 0).getDate();
    const params = new URLSearchParams({
      dateFrom:  `${ym}-01`,
      dateTo:    `${ym}-${String(last).padStart(2,"0")}`,
      ...(coachId   ? { coachId }   : {}),
      ...(completed ? { completed } : {}),
    });
    fetch(`/api/admin/logs?${params}`)
      .then(r=>r.json())
      .then(d=>{ if(d.success) setLogs(d.logs); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[ym, coachId, completed]);

  useEffect(()=>{ load(); },[load]);

  function exportCsv() {
    const [y,m] = ym.split("-");
    const last  = new Date(Number(y), Number(m), 0).getDate();
    window.open(`/api/admin/export/csv?type=logs&from=${ym}-01&to=${ym}-${String(last).padStart(2,"0")}`, "_blank");
  }

  const confirmed = logs.filter(l=>l.isCompleted).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-xl font-black text-slate-900">일지 내용 열람</h1>
          <p className="mt-0.5 text-sm text-slate-500">직무지도원이 작성한 훈련 일지를 확인합니다.</p></div>
        <button onClick={exportCsv}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 active:scale-95">
          <Download className="h-4 w-4"/>CSV 내보내기
        </button>
      </div>

      {/* 필터 */}
      <div className="mb-4 flex flex-wrap gap-2">
        <input type="month" value={ym} onChange={e=>setYm(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
        <select value={coachId} onChange={e=>setCoachId(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
          <option value="">전체 직무지도원</option>
          {workers.map(c=><option key={c.id} value={c.id}>{c.userName}</option>)}
        </select>
        <select value={completed} onChange={e=>setCompleted(e.target.value)}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
          <option value="">전체 상태</option>
          <option value="true">확정</option>
          <option value="false">미확정</option>
        </select>
        <button onClick={load}
          className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white active:scale-95">
          <Search className="h-4 w-4"/>
        </button>
      </div>

      <div className="mb-3 flex gap-3 text-sm font-semibold text-slate-500">
        <span>전체 <b className="text-slate-900">{logs.length}</b>건</span>
        <span>확정 <b className="text-emerald-600">{confirmed}</b>건</span>
        <span>미확정 <b className="text-amber-600">{logs.length-confirmed}</b>건</span>
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):logs.length===0?(
        <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <p className="text-sm text-slate-400">일지가 없습니다.</p>
        </div>
      ):(
        <div className="space-y-2">
          {logs.map(l=>(
            <div key={l.id} className={`rounded-2xl border bg-white ${l.isCompleted?"border-emerald-100":"border-slate-100"}`}>
              <button onClick={()=>setExpandId(expandId===l.id?null:l.id)}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-black text-slate-900">
                      {l.workDate} ({DOW[new Date(l.workDate+"T00:00:00").getDay()]})
                    </span>
                    <span className="text-sm font-semibold text-slate-600">{l.coachName}</span>
                    <span className="text-sm text-slate-400">→ {l.traineeName}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{TYPE_LABELS[l.trainingType]??l.trainingType}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${l.isCompleted?"bg-emerald-100 text-emerald-700":"bg-amber-100 text-amber-700"}`}>
                      {l.isCompleted?"확정":"미확정"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {l.siteName} · {l.totalTime}h · {l.attendance}
                    {l.taskName?` · ${l.taskName}`:""}
                  </p>
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
      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
