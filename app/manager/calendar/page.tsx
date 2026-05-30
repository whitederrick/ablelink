"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

type Worker = { id: string; workerName: string; siteName: string };
type AttRec = { workDate: string; status: string; startTime: string|null; endTime: string|null; isFinalClosed: boolean; isGpsModified: boolean };

const DOW_HEADER = ["일","월","화","수","목","금","토"];

function pad2(n: number) { return String(n).padStart(2,"0"); }
function nowYM() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`; }
function hhMM(iso: string|null) {
  if(!iso) return "--:--";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export default function ManagerCalendarPage() {
  const [workers, setWorkers]       = useState<Worker[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<Worker|null>(null);
  const [records, setRecords]       = useState<AttRec[]>([]);
  const [yearMonth, setYearMonth]   = useState(nowYM());
  const [loading, setLoading]       = useState(false);

  useEffect(()=>{
    fetch("/api/admin/workers?pageSize=200").then(r=>r.json())
      .then(d=>{
        if(d.success) {
          const list = d.data?.map((c:any)=>({id:c.id,workerName:c.workerName,siteName:c.currentSiteName??c.siteName??""}))||[];
          setWorkers(list);
          if(list.length>0) setSelectedWorker(list[0]);
        }
      }).catch(()=>{});
  },[]);

  const load = useCallback(()=>{
    if(!selectedWorker) return;
    setLoading(true);
    fetch(`/api/admin/attendances?workerId=${selectedWorker.id}&yearMonth=${yearMonth}`)
      .then(r=>r.json())
      .then(d=>{ if(d.success) setRecords(d.records||d.attendances||[]); })
      .catch(()=>{})
      .finally(()=>setLoading(false));
  },[selectedWorker, yearMonth]);

  useEffect(()=>{ load(); },[load]);

  function changeMonth(delta: number) {
    const [y,m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m-1+delta, 1);
    setYearMonth(`${d.getFullYear()}-${pad2(d.getMonth()+1)}`);
  }

  // 캘린더 날짜 생성
  const [y, m] = yearMonth.split("-").map(Number);
  const firstDay = new Date(y, m-1, 1).getDay();
  const lastDate = new Date(y, m, 0).getDate();
  const recordMap: Record<string, AttRec> = {};
  for(const r of records) recordMap[r.workDate] = r;

  const cells: (number|null)[] = [...Array(firstDay).fill(null), ...Array.from({length:lastDate},(_,i)=>i+1)];
  while(cells.length%7!==0) cells.push(null);

  function dayColor(dateStr: string) {
    const r = recordMap[dateStr];
    if(!r) return "";
    if(r.isFinalClosed) return "bg-emerald-50 border-emerald-200";
    if(r.status==="DONE")    return "bg-amber-50 border-amber-200";
    if(r.status==="WORKING") return "bg-sky-50 border-sky-200";
    return "";
  }

  function dayLabel(dateStr: string) {
    const r = recordMap[dateStr];
    if(!r) return null;
    return <div className="text-[9px] font-semibold leading-tight text-slate-500 mt-0.5">
      {hhMM(r.startTime)}~{hhMM(r.endTime)}
      {r.isFinalClosed&&<span className="ml-1 text-emerald-600">✓</span>}
      {r.isGpsModified&&<span className="ml-1 text-amber-600">⚠</span>}
    </div>;
  }

  const working  = records.filter(r=>r.startTime).length;
  const finalized = records.filter(r=>r.isFinalClosed).length;

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-black text-slate-900">근태 캘린더</h1>
        <p className="mt-0.5 text-sm text-slate-500">직무지도원별 월간 출근 현황</p></div>

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <select value={selectedWorker?.id??""} onChange={e=>{const c=workers.find(x=>x.id===e.target.value);setSelectedWorker(c??null);}}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400 min-w-[160px]">
          {workers.map(c=><option key={c.id} value={c.id}>{c.workerName}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <button onClick={()=>changeMonth(-1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 active:scale-95">
            <ChevronLeft className="h-4 w-4"/>
          </button>
          <span className="text-base font-black text-slate-900 min-w-[100px] text-center">{yearMonth.replace("-","년 ")}월</span>
          <button onClick={()=>changeMonth(1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:bg-slate-50 active:scale-95">
            <ChevronRight className="h-4 w-4"/>
          </button>
        </div>
        <button onClick={()=>window.open(`/api/admin/export/csv?type=attendance&from=${yearMonth}-01&to=${yearMonth}-${pad2(lastDate)}&workerId=${selectedWorker?.id??""}`,"_blank")}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 active:scale-95">
          <Download className="h-4 w-4"/>내보내기
        </button>
      </div>

      {selectedWorker&&(
        <p className="mb-2 text-sm text-slate-500">
          {selectedWorker.siteName&&<span className="mr-2">{selectedWorker.siteName} ·</span>}
          출근 <b className="text-slate-900">{working}일</b> ·
          확정 <b className="text-emerald-600">{finalized}일</b>
        </p>
      )}

      {loading?(
        <div className="flex h-60 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {DOW_HEADER.map((d,i)=>(
              <div key={d} className={`py-2 text-center text-xs font-black ${i===0?"text-rose-400":i===6?"text-blue-400":"text-slate-500"}`}>{d}</div>
            ))}
          </div>
          {/* 날짜 그리드 */}
          {Array.from({length:cells.length/7},(_,week)=>(
            <div key={week} className="grid grid-cols-7 border-b border-slate-50 last:border-0">
              {cells.slice(week*7,(week+1)*7).map((day, di)=>{
                const dateStr = day ? `${yearMonth}-${pad2(day)}` : "";
                const isWeekend = di===0||di===6;
                return (
                  <div key={di} className={`min-h-[56px] border-r border-slate-50 last:border-0 p-1.5 ${day?dayColor(dateStr):"bg-slate-50/50"}`}>
                    {day&&<>
                      <p className={`text-xs font-black ${isWeekend?di===0?"text-rose-400":"text-blue-400":"text-slate-700"}`}>{day}</p>
                      {dayLabel(dateStr)}
                    </>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* 범례 */}
      <div className="mt-3 flex gap-4 text-[11px] font-semibold text-slate-500">
        {[["bg-emerald-50 border border-emerald-200","확정"],["bg-amber-50 border border-amber-200","마감중"],["bg-sky-50 border border-sky-200","근무중"]].map(([cls,label])=>(
          <div key={label} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded ${cls}`}/>
            <span>{label}</span>
          </div>
        ))}
        <span>⚠ GPS 수동조정</span>
      </div>
    </div>
  );
}
