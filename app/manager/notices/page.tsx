"use client";

import { useCallback, useEffect, useState } from "react";
import { Send, Users, User, Building2 } from "lucide-react";
import PageHeader from "../_components/PageHeader";

type Worker  = { id: string; workerName: string; siteName: string };
type Site    = { id: string; companyName: string };
type SendMode = "ALL" | "GROUP" | "INDIVIDUAL";
type Notice = { id: string; workerId: string; workerName: string; title: string; body: string; type: string; read: boolean; createdAt: string };

const TYPE_OPTS = [
  { val:"INFO",   label:"일반 안내",  cls:"bg-sky-100 text-sky-700" },
  { val:"WARN",   label:"주의/경고",  cls:"bg-amber-100 text-amber-700" },
  { val:"REJECT", label:"반려",       cls:"bg-rose-100 text-rose-700" },
];

export default function NoticesPage() {
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [notices, setNotices]   = useState<Notice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [tab, setTab]           = useState<"send"|"history">("send");
  const [toast, setToast]       = useState("");

  // 발송 폼
  const [mode, setMode] = useState<SendMode>("ALL");
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSite, setSelectedSite] = useState("");
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
  const [title, setTitle]   = useState("");
  const [body, setBody]     = useState("");
  const [type, setType]     = useState("INFO");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  const loadNotices = useCallback(()=>{
    fetch("/api/admin/notices?limit=100").then(r=>r.json())
      .then(d=>{ if(d.success) setNotices(d.notices); }).catch(()=>{});
  },[]);

  useEffect(()=>{
    fetch("/api/admin/workers?pageSize=200").then(r=>r.json())
      .then(d=>{
        if(d.success) setWorkers(d.data?.map((c:any)=>({id:c.id,workerName:c.workerName,siteName:c.currentSiteName??c.siteName??""}))||[]);
      }).catch(()=>{}).finally(()=>setLoading(false));
    fetch("/api/admin/sites?pageSize=200").then(r=>r.json())
      .then(d=>{ if(d.success) setSites((d.items||[]).map((s:any)=>({id:String(s.id),companyName:s.companyName}))); }).catch(()=>{});
    loadNotices();
  },[loadNotices]);

  async function send() {
    if(!title.trim()||!body.trim()){showToast("제목과 내용을 입력해주세요.");return;}
    if(mode==="GROUP"&&!selectedSite){showToast("현장을 선택해주세요.");return;}
    if(mode==="INDIVIDUAL"&&selectedWorkers.size===0){showToast("직무지도원을 선택해주세요.");return;}
    setSending(true);
    const payload: any = { audience: mode, title: title.trim(), body: body.trim(), type };
    if(mode==="GROUP") payload.siteId = selectedSite;
    if(mode==="INDIVIDUAL") payload.userIds = [...selectedWorkers];
    const res = await fetch("/api/admin/notices",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setSending(false);
    if(data.success){
      showToast(`${data.sent}명에게 발송했습니다.`);
      setTitle(""); setBody(""); setType("INFO"); setSelectedWorkers(new Set()); setSelectedSite("");
      loadNotices();
    } else showToast(data.message||"발송 실패");
  }

  return (
    <div>
      <PageHeader title="알림 발송(전체/그룹/개별)" sub="직무지도원에게 전체·현장 그룹·개별로 알림을 발송합니다." />

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
              {([
                { m:"ALL" as SendMode,        icon:<Users className="h-4 w-4"/>,    label:"전체" },
                { m:"GROUP" as SendMode,      icon:<Building2 className="h-4 w-4"/>, label:"그룹(현장)" },
                { m:"INDIVIDUAL" as SendMode, icon:<User className="h-4 w-4"/>,     label:"개별" },
              ]).map(o=>(
                <button key={o.m} onClick={()=>setMode(o.m)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition ${mode===o.m?"border-slate-950 bg-slate-950 text-white":"border-slate-200 bg-white text-slate-600"}`}>
                  {o.icon}{o.label}
                </button>
              ))}
            </div>
            {mode==="GROUP"&&(
              <select value={selectedSite} onChange={e=>setSelectedSite(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400">
                <option value="">현장 선택…</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.companyName}</option>)}
              </select>
            )}
            {mode==="INDIVIDUAL"&&(
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {workers.map(c=>(
                  <label key={c.id} className="flex items-center gap-2.5 cursor-pointer rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <input type="checkbox"
                      checked={selectedWorkers.has(c.id)}
                      onChange={e=>{
                        const next = new Set(selectedWorkers);
                        e.target.checked ? next.add(c.id) : next.delete(c.id);
                        setSelectedWorkers(next);
                      }}
                      className="h-4 w-4 accent-slate-950"/>
                    <span className="text-sm font-semibold text-slate-800">{c.workerName}</span>
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
              :<><Send className="h-4 w-4"/>{mode==="ALL"?"전체":mode==="GROUP"?"현장 그룹":"선택"} 직무지도원에게 발송</>}
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
                    <p className="mt-0.5 text-xs text-slate-500">수신: {n.workerName}</p>
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
