"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, X, ChevronDown, ChevronUp, Search } from "lucide-react";

type Trainee = {
  id: string; siteId: string; siteName: string; name: string; gender: string;
  birthDate: string|null; phoneNumber: string|null; guardianPhoneNumber: string|null;
  disabilityType: string; severity: string; status: string; note: string|null; createdAt: string;
};
type Site = { id: string; companyName: string };

const STATUS_COLORS: Record<string,string> = {
  TRAINING:"bg-sky-100 text-sky-700", EMPLOYED:"bg-emerald-100 text-emerald-700",
  DROPOUT:"bg-rose-100 text-rose-700", GRADUATED:"bg-slate-100 text-slate-500",
};
const STATUS_LABELS: Record<string,string> = { TRAINING:"훈련중", EMPLOYED:"취업", DROPOUT:"중도포기", GRADUATED:"수료" };

const EMPTY = { siteId:"", name:"", gender:"M", birthDate:"", phoneNumber:"", guardianPhoneNumber:"", disabilityType:"지적장애", severity:"경증", note:"", status:"TRAINING" };

export default function TraineesPage() {
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [sites, setSites]       = useState<Site[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm]         = useState<typeof EMPTY & { id?: string }>(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  const load = useCallback(()=>{
    setLoading(true);
    Promise.all([
      fetch("/api/admin/trainees").then(r=>r.json()),
      fetch("/api/admin/sites?limit=200").then(r=>r.json()),
    ]).then(([tRes, sRes])=>{
      if(tRes.success) setTrainees(tRes.trainees);
      if(sRes.success) setSites(sRes.sites?.map((s:any)=>({id:s.id,companyName:s.companyName}))||[]);
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{ load(); },[load]);

  function openCreate() { setForm({...EMPTY}); setShowForm(true); }
  function openEdit(t: Trainee) {
    setForm({ id:t.id, siteId:t.siteId, name:t.name, gender:t.gender,
              birthDate:t.birthDate??"", phoneNumber:t.phoneNumber??"",
              guardianPhoneNumber:t.guardianPhoneNumber??"", disabilityType:t.disabilityType,
              severity:t.severity, note:t.note??"", status:t.status });
    setShowForm(true);
  }

  async function save() {
    if(!form.name.trim()||!form.siteId){showToast("필수 항목을 입력하세요.");return;}
    setSaving(true);
    const url  = form.id ? `/api/admin/trainees/${form.id}` : "/api/admin/trainees";
    const method = form.id ? "PATCH" : "POST";
    const res  = await fetch(url,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
    const data = await res.json();
    setSaving(false);
    if(data.success){ showToast(form.id?"수정되었습니다.":"등록되었습니다."); setShowForm(false); load(); }
    else showToast(data.message||"저장 실패");
  }

  function toggle(id: string) {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  }

  const filtered = trainees.filter(t =>
    t.name.includes(search) || t.siteName.includes(search) || t.disabilityType.includes(search)
  );

  // 사이트별 그룹
  const bysite: Record<string,Trainee[]> = {};
  for(const t of filtered) (bysite[t.siteId]??=[]).push(t);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div><h1 className="text-xl font-black text-slate-900">훈련생 관리</h1>
          <p className="mt-0.5 text-sm text-slate-500">전체 {trainees.length}명 훈련생</p></div>
        <button onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-black text-white active:scale-95">
          <Plus className="h-4 w-4"/>훈련생 등록
        </button>
      </div>

      <div className="mb-4">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="이름·현장·장애유형 검색..."
          className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
      </div>

      {/* 폼 모달 */}
      {showForm&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-black text-slate-900">{form.id?"훈련생 수정":"훈련생 등록"}</p>
              <button onClick={()=>setShowForm(false)}><X className="h-5 w-5 text-slate-400"/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-semibold text-slate-600">현장 *</label>
                <select value={form.siteId} onChange={e=>setForm(f=>({...f,siteId:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                  <option value="">현장 선택</option>
                  {sites.map(s=><option key={s.id} value={s.id}>{s.companyName}</option>)}
                </select>
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">이름 *</label>
                <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="성명"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">성별</label>
                <select value={form.gender} onChange={e=>setForm(f=>({...f,gender:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                  <option value="M">남</option><option value="F">여</option>
                </select></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">생년월일</label>
                <input type="date" value={form.birthDate??""} onChange={e=>setForm(f=>({...f,birthDate:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">연락처</label>
                <input value={form.phoneNumber??""} onChange={e=>setForm(f=>({...f,phoneNumber:e.target.value}))} placeholder="010-0000-0000"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">보호자 연락처</label>
                <input value={form.guardianPhoneNumber??""} onChange={e=>setForm(f=>({...f,guardianPhoneNumber:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">장애 유형</label>
                <input value={form.disabilityType} onChange={e=>setForm(f=>({...f,disabilityType:e.target.value}))} placeholder="지적장애"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">장애 정도</label>
                <select value={form.severity} onChange={e=>setForm(f=>({...f,severity:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                  <option>경증</option><option>중증</option>
                </select></div>
              {form.id&&<div><label className="mb-1 block text-xs font-semibold text-slate-600">상태</label>
                <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                  {Object.entries(STATUS_LABELS).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select></div>}
              <div className={form.id?"":"col-span-2"}>
                <label className="mb-1 block text-xs font-semibold text-slate-600">비고</label>
                <input value={form.note??""} onChange={e=>setForm(f=>({...f,note:e.target.value}))}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={()=>setShowForm(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">취소</button>
              <button onClick={save} disabled={saving} className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">
                {saving?"저장 중...":form.id?"수정 완료":"등록"}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className="space-y-3">
          {Object.entries(bysite).map(([sid, ts])=>{
            const isOpen = expanded.has(sid);
            return (
              <div key={sid} className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
                <button onClick={()=>toggle(sid)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left">
                  <span className="flex-1 font-black text-slate-900">{ts[0].siteName}</span>
                  <span className="text-sm text-slate-400">{ts.length}명</span>
                  {isOpen?<ChevronUp className="h-4 w-4 text-slate-400"/>:<ChevronDown className="h-4 w-4 text-slate-400"/>}
                </button>
                {isOpen&&(
                  <div className="border-t border-slate-100 divide-y divide-slate-50">
                    {ts.map(t=>(
                      <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">{t.name}</span>
                            <span className="text-xs text-slate-400">{t.gender==="M"?"남":"여"}</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${STATUS_COLORS[t.status]??"bg-slate-100 text-slate-500"}`}>
                              {STATUS_LABELS[t.status]??t.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">{t.disabilityType} · {t.severity}{t.phoneNumber?` · ${t.phoneNumber}`:""}</p>
                        </div>
                        <button onClick={()=>openEdit(t)}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 active:scale-95">
                          <Pencil className="h-3.5 w-3.5"/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length===0&&<div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white"><p className="text-sm text-slate-400">훈련생이 없습니다.</p></div>}
        </div>
      )}
      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
