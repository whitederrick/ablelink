"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, KeyRound, UserX, UserCheck } from "lucide-react";

type Coach = {
  id: string; loginId: string; userName: string; phoneNumber: string;
  status: string; planType: string; siteName: string|null;
  agencyId: string|null; agencyName: string|null; createdAt: string;
};

const STATUS_COLORS: Record<string,string> = {
  ACTIVE:"bg-emerald-100 text-emerald-700", RESIGNED:"bg-rose-100 text-rose-700", PAUSED:"bg-amber-100 text-amber-700",
};

export default function CoachesPage() {
  const [coaches, setCoaches]   = useState<Coach[]>([]);
  const [loading, setLoading]   = useState(true);
  const [q, setQ]               = useState("");
  const [actionId, setActionId] = useState<string|null>(null);
  const [actionType, setActionType] = useState<"pw"|"status"|null>(null);
  const [newPw, setNewPw]       = useState("");
  const [newStatus, setNewStatus] = useState("RESIGNED");
  const [memo, setMemo]         = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };
  const load = useCallback((query="")=>{
    setLoading(true);
    fetch(`/api/admin/system/coaches?q=${encodeURIComponent(query)}`)
      .then(r=>r.json()).then(d=>{if(d.success)setCoaches(d.coaches);}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{load();},[load]);

  async function doAction(){
    if(!actionId||!actionType)return;
    setProcessing(true);
    let body: any;
    if(actionType==="pw"){
      if(newPw.length<8){showToast("8자 이상 입력하세요.");setProcessing(false);return;}
      body={action:"reset-password",newPassword:newPw};
    } else {
      body={action:"set-status",status:newStatus,memo};
    }
    const res=await fetch(`/api/admin/system/coaches/${actionId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast(data.message);setActionId(null);setActionType(null);setNewPw("");setMemo("");load(q);}
    else showToast(data.message||"실패");
  }

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-black text-slate-900">전체 직무지도원</h1>
        <p className="mt-0.5 text-sm text-slate-500">전체 {coaches.length}명 · 비밀번호 초기화 및 상태 변경</p></div>

      <div className="mb-4 flex gap-2">
        <input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(q)}
          placeholder="이름·전화번호·아이디 검색..."
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
        <button onClick={()=>load(q)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white active:scale-95">
          <Search className="h-4 w-4"/>
        </button>
      </div>

      {actionId&&actionType&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-4 text-base font-black text-slate-900">{actionType==="pw"?"비밀번호 초기화":"상태 변경"}</p>
            {actionType==="pw"?(
              <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="새 비밀번호 (8자 이상)"
                className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            ):(
              <>
                <select value={newStatus} onChange={e=>setNewStatus(e.target.value)}
                  className="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none">
                  <option value="ACTIVE">ACTIVE (활성)</option>
                  <option value="PAUSED">PAUSED (일시정지)</option>
                  <option value="RESIGNED">RESIGNED (퇴직)</option>
                </select>
                <textarea value={memo} onChange={e=>setMemo(e.target.value)} rows={2} placeholder="변경 사유 (감사 로그 기록)"
                  className="mb-4 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold outline-none"/>
              </>
            )}
            <div className="flex gap-2">
              <button onClick={()=>{setActionId(null);setActionType(null);setNewPw("");setMemo("");}}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">취소</button>
              <button onClick={doAction} disabled={processing}
                className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">{processing?"...":"확인"}</button>
            </div>
          </div>
        </div>
      )}

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-100 bg-slate-50">
              {["이름/아이디","연락처","소속 에이전시","현장","상태","작업"].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-black uppercase tracking-wide text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {coaches.length===0?(<tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">직무지도원이 없습니다.</td></tr>)
              :coaches.map(c=>(
                <tr key={c.id} className={`hover:bg-slate-50 transition ${c.status!=="ACTIVE"?"opacity-60":""}`}>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-900">{c.userName}</p><p className="text-xs text-slate-400">{c.loginId}</p></td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{c.phoneNumber}</td>
                  <td className="px-4 py-3">{c.agencyName?<span className="text-sm font-semibold text-slate-700">{c.agencyName}</span>:<span className="text-slate-300 text-xs">미배정</span>}</td>
                  <td className="px-4 py-3">{c.siteName?<span className="text-xs text-slate-600">{c.siteName}</span>:<span className="text-slate-300 text-xs">없음</span>}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${STATUS_COLORS[c.status]??"bg-slate-100 text-slate-600"}`}>{c.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={()=>{setActionId(c.id);setActionType("pw");}} title="비밀번호 초기화"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 active:scale-95"><KeyRound className="h-3.5 w-3.5"/></button>
                      <button onClick={()=>{setActionId(c.id);setActionType("status");setNewStatus(c.status==="ACTIVE"?"RESIGNED":"ACTIVE");}} title="상태 변경"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 active:scale-95">
                        {c.status==="ACTIVE"?<UserX className="h-3.5 w-3.5 text-rose-500"/>:<UserCheck className="h-3.5 w-3.5 text-emerald-600"/>}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
