"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Bell, X, Users, User } from "lucide-react";

type Coach  = { id: string; userName: string; siteName: string };
type Notice = { id: string; userId: string; userName: string; title: string; body: string; type: string; read: boolean; createdAt: string };

const TYPE_OPTS = [
  { val:"INFO",   label:"일반 안내",  cls:"bg-sky-100 text-sky-700" },
  { val:"WARN",   label:"주의/경고",  cls:"bg-amber-100 text-amber-700" },
  { val:"REJECT", label:"반려",       cls:"bg-rose-100 text-rose-700" },
];

export default function NoticesPage() {
  const [coaches, setCoaches]   = useState<Coach[]>([]);
  const [notices, setNotices]   = useState<Notice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [tab, setTab]           = useState<"send"|"history">("send");
  const [toast, setToast]       = useState("");

  // 발송 폼
  const [targetAll, setTargetAll] = useState(true);
  const [selectedCoaches, setSelectedCoaches] = useState<Set<string>>(new Set());
  const [title, setTitle]   = useState("");
  const [body, setBody]     = useState("");
  const [type, setType]     = useState("INFO");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  const loadNotices = useCallback(()=>{
    fetch("/api/admin/notices?limit=100").then(r=>r.json())
      .then(d=>{ if(d.success) setNotices(d.notices); }).catch(()=>{});
  },[]);

  useEffect(()=>{
    fetch("/api/admin/coaches?pageSize=200").then(r=>r.json())
      .then(d=>{
        if(d.success) setCoaches(d.coaches?.map((c:any)=>({id:c.id,userName:c.userName,siteName:c.currentSiteName??c.siteName??""}))||[]);
      }).catch(()=>{}).finally(()=>setLoading(false));
    loadNotices();
  },[loadNotices]);

  async function send() {
    if(!title.trim()||!body.trim()){showToast("제목과 내용을 입력해주세요.");return;}
    setSending(true);
    const userIds = targetAll ? undefined : [...selectedCoaches];
    const res = await fetch("/api/admin/notices",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ userIds, title: title.trim(), body: body.trim(), type }),
    });
    const data = await res.json();
    setSending(false);
    if(data.success){
      showToast(`${data.sent}명에게 공지를 발송했습니다.`);
      setTitle(""); setBody(""); setType("INFO"); setSelectedCoaches(new Set());
      loadNotices();
    } else showToast(data.message||"발송 실패");
  }

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-black text-slate-900">공지 발송</h1>
        <p className="mt-0.5 text-sm text-slate-500">직무지도원에게 공지·안내·반려 알림을 발송합니다.</p></div>

      <div className="mb-4 flex gap-2">
        {(["send","history"] as const).map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${tab===t?"border-slate-950 bg-slate-950 text-white":"border-slate-200 bg-white text-slate-600"}`}>
            {t==="send"?"공지 보내기":"발송 이력"}
          </button>
        ))}
      </div>

      {tab==="send"&&(
        <div className="space-y-4 max-w-2xl">
          {/* 수신 대상 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-5">
            <p className="mb-3 text-sm font-black text-slate-900">수신 대상</p>
            <div className="flex gap-2 mb-3">
              <button onClick={()=>setTargetAll(true)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition ${targetAll?"border-slate-950 bg-slate-950 text-white":"border-slate-200 bg-white text-slate-600"}`}>
                <Users className="h-4 w-4"/>전체 직무지도원
              </button>
              <button onClick={()=>setTargetAll(false)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition ${!targetAll?"border-slate-950 bg-slate-950 text-white":"border-slate-200 bg-white text-slate-600"}`}>
                <User className="h-4 w-4"/>개별 선택
              </button>
            </div>
            {!targetAll&&(
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {coaches.map(c=>(
                  <label key={c.id} className="flex items-center gap-2.5 cursor-pointer rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <input type="checkbox"
                      checked={selectedCoaches.has(c.id)}
                      onChange={e=>{
                        const next = new Set(selectedCoaches);
                        e.target.checked ? next.add(c.id) : next.delete(c.id);
                        setSelectedCoaches(next);
                      }}
                      className="h-4 w-4 accent-slate-950"/>
                    <span className="text-sm font-semibold text-slate-800">{c.userName}</span>
                    {c.siteName&&<span className="text-xs text-slate-400">{c.siteName}</span>}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 알림 유형 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-5">
            <p className="mb-3 text-sm font-black text-slate-900">알림 유형</p>
            <div className="flex gap-2">
              {TYPE_OPTS.map(o=>(
                <button key={o.val} onClick={()=>setType(o.val)}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${type===o.val?o.cls+" border-current":"border-slate-200 bg-white text-slate-500"}`}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 내용 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-5 space-y-3">
            <p className="text-sm font-black text-slate-900">내용 작성</p>
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="제목 (100자 이내)"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <textarea value={body} onChange={e=>setBody(e.target.value)} rows={4} placeholder="내용 (500자 이내)"
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold outline-none focus:border-sky-400"/>
            <button onClick={send} disabled={sending||!title.trim()||!body.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 py-3.5 text-sm font-black text-white active:scale-[0.98] disabled:opacity-60">
              {sending?<><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"/>발송 중...</>
              :<><Send className="h-4 w-4"/>{targetAll?"전체":"선택"} 직무지도원에게 발송</>}
            </button>
          </div>
        </div>
      )}

      {tab==="history"&&(
        <div className="space-y-2">
          {notices.length===0?(
            <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
              <p className="text-sm text-slate-400">발송 이력이 없습니다.</p>
            </div>
          ):notices.map(n=>{
            const t = TYPE_OPTS.find(o=>o.val===n.type);
            return (
              <div key={n.id} className="rounded-2xl border border-slate-100 bg-white px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-black text-slate-900">{n.title}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${t?.cls??"bg-slate-100 text-slate-600"}`}>{t?.label??n.type}</span>
                      {!n.read&&<span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-600">미확인</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">수신: {n.userName}</p>
                    <p className="mt-1 text-sm text-slate-600 leading-relaxed">{n.body}</p>
                  </div>
                  <p className="text-[11px] text-slate-400 shrink-0">{new Date(n.createdAt).toLocaleDateString("ko-KR")}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
