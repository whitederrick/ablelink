"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Building2, Users, MapPin, ChevronDown, Plus, X, ExternalLink } from "lucide-react";
import PageHeader from "../_components/PageHeader";
import AgencyDetail from "./AgencyDetail";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Agency = {
  id: string; name: string; planType: string; trialEndsAt: string | null;
  nextBillingAt: string | null; subscribedAt: string | null;
  maxWorkers: number; maxSites: number;
  createdAt: string; managerCount: number; siteCount: number;
};

const PLAN_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  FREE:     { label: "FREE",     tone: "slate" },
  TRIAL:    { label: "TRIAL",    tone: "amber" },
  STARTER:  { label: "STARTER",  tone: "sky" },
  STANDARD: { label: "STANDARD", tone: "violet" },
  PRO:      { label: "PRO",      tone: "emerald" },
};
const PLANS = ["FREE","TRIAL","STARTER","STANDARD","PRO"];

export default function AgenciesPage() {
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [planFilter, setPlanFilter] = useState<string[]>([]);
  const [editId, setEditId]     = useState<string|null>(null);
  const [editPlan, setEditPlan] = useState(""); const [editTrial, setEditTrial] = useState("");
  const [editMaxWorkers, setEditMaxWorkers] = useState(""); const [editMaxSites, setEditMaxSites] = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string|null>(null);
  const [form, setForm] = useState({ name:"", planType:"FREE", managerLoginId:"", managerPassword:"", managerDisplayName:"" });

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  const load = useCallback(()=>{
    setLoading(true);
    fetch("/api/admin/system/agencies").then(r=>r.json()).then(d=>{if(d.success)setAgencies(d.agencies);}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{load();},[load]);

  function openEdit(a: Agency){setEditId(a.id);setEditPlan(a.planType);setEditTrial(a.trialEndsAt?a.trialEndsAt.slice(0,10):"");setEditMaxWorkers(String(a.maxWorkers));setEditMaxSites(String(a.maxSites));}

  async function savePlan(){
    if(!editId)return; setProcessing(true);
    const res=await fetch(`/api/admin/system/agencies/${editId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({planType:editPlan,trialEndsAt:editTrial||null,maxWorkers:Number(editMaxWorkers)||0,maxSites:Number(editMaxSites)||0})});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast(data.message);setEditId(null);load();}else showToast(data.message||"실패");
  }

  async function createAgency(){
    if(!form.name||!form.managerLoginId||!form.managerPassword){showToast("필수 항목을 입력해주세요.");return;}
    setProcessing(true);
    const res=await fetch("/api/admin/system/agencies",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast("에이전시가 생성되었습니다.");setShowCreate(false);setForm({name:"",planType:"FREE",managerLoginId:"",managerPassword:"",managerDisplayName:""});load();}else showToast(data.message||"생성 실패");
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return agencies
      .filter(a => planFilter.length === 0 || planFilter.includes(a.planType))
      .filter(a => !q || a.name.toLowerCase().includes(q));
  }, [agencies, search, planFilter]);
  const togglePlan = (v: string) => setPlanFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);
  const planCnt = (p: string) => agencies.filter(a => a.planType === p).length;

  return (
    <div>
      <PageHeader
        title="에이전시 관리"
        sub={`전체 ${agencies.length}개 · 플랜 변경 및 신규 생성`}
        actions={
          <button onClick={()=>setShowCreate(true)} className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white active:scale-95">
            <Plus className="h-4 w-4" />에이전시 생성
          </button>
        }
      />

      {/* 에이전시 생성 모달 */}
      {showCreate&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-base font-black text-slate-900">신규 에이전시 생성</p>
              <button onClick={()=>setShowCreate(false)}><X className="h-5 w-5 text-slate-400"/></button>
            </div>
            <div className="space-y-3">
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">에이전시 이름 *</label>
                <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="기관명" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">초기 플랜</label>
                <select value={form.planType} onChange={e=>setForm(f=>({...f,planType:e.target.value}))} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400">
                  {PLANS.map(p=><option key={p} value={p}>{p}</option>)}
                </select></div>
              <p className="text-xs font-black text-slate-500 pt-1">최초 관리자 계정</p>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="mb-1 block text-xs font-semibold text-slate-600">아이디 *</label>
                  <input value={form.managerLoginId} onChange={e=>setForm(f=>({...f,managerLoginId:e.target.value}))} placeholder="관리자 아이디" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
                <div><label className="mb-1 block text-xs font-semibold text-slate-600">비밀번호 *</label>
                  <input type="password" value={form.managerPassword} onChange={e=>setForm(f=>({...f,managerPassword:e.target.value}))} placeholder="8자 이상" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
              </div>
              <div><label className="mb-1 block text-xs font-semibold text-slate-600">담당자 이름</label>
                <input value={form.managerDisplayName} onChange={e=>setForm(f=>({...f,managerDisplayName:e.target.value}))} placeholder="이름 (선택)" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={()=>setShowCreate(false)} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">취소</button>
              <button onClick={createAgency} disabled={processing} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">{processing?"생성 중...":"에이전시 생성"}</button>
            </div>
          </div>
        </div>
      )}

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체", value: agencies.length },
          { label: "유료(STARTER+)", value: planCnt("STARTER") + planCnt("STANDARD") + planCnt("PRO"), tone: "emerald" },
          { label: "체험(TRIAL)", value: planCnt("TRIAL"), tone: "amber" },
          { label: "무료(FREE)", value: planCnt("FREE"), tone: "slate" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={search}
          onQueryChange={setSearch}
          placeholder="에이전시 이름 검색"
          filters={PLANS.map(p => ({ value: p, label: p, count: planCnt(p) })) as FilterChip[]}
          selected={planFilter}
          onToggleFilter={togglePlan}
        />
      </div>

      {loading?(
        <div className="flex h-40 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950"/></div>
      ):(
        <div className="space-y-2">
          {filtered.length===0?(
            <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white"><p className="text-sm text-slate-400">{agencies.length===0?"에이전시가 없습니다.":"조건에 맞는 에이전시가 없습니다."}</p></div>
          ):filtered.map(a=>(
            <div key={a.id} className="rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 flex-shrink-0">
                  <Building2 className="h-5 w-5 text-slate-500"/>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setDetailId(a.id)} className="text-[15px] font-semibold text-slate-800 hover:text-sky-600 hover:underline">{a.name}</button>
                    <StatusBadge status={a.planType} map={PLAN_BADGE} />
                    {a.trialEndsAt&&<span className="text-[13px] text-slate-500">체험 ~{new Date(a.trialEndsAt).toLocaleDateString("ko-KR")}</span>}
                    {a.nextBillingAt&&<span className="text-[13px] text-emerald-600">다음결제 {new Date(a.nextBillingAt).toLocaleDateString("ko-KR")}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-[13px] text-slate-500">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3"/>{a.managerCount}명 관리자</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{a.siteCount}개소</span>
                    <span>한도 {a.maxWorkers||"∞"}명/{a.maxSites||"∞"}개소</span>
                    <span>가입 {new Date(a.createdAt).toLocaleDateString("ko-KR")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button onClick={() => setDetailId(a.id)}
                    className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:scale-95">
                    상세 <ExternalLink className="h-3 w-3"/>
                  </button>
                  <button onClick={()=>editId===a.id?setEditId(null):openEdit(a)}
                    className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 active:scale-95">
                    플랜 변경 <ChevronDown className={`h-3 w-3 transition ${editId===a.id?"rotate-180":""}`}/>
                  </button>
                </div>
              </div>
              {editId===a.id&&(
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div><label className="mb-1 block text-[11px] font-semibold text-slate-500">플랜</label>
                      <select value={editPlan} onChange={e=>setEditPlan(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400">
                        {PLANS.map(p=><option key={p} value={p}>{p}</option>)}
                      </select></div>
                    {editPlan==="TRIAL"&&<div><label className="mb-1 block text-[11px] font-semibold text-slate-500">체험 종료일</label>
                      <input type="date" value={editTrial} onChange={e=>setEditTrial(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>}
                    <div><label className="mb-1 block text-[11px] font-semibold text-slate-500">최대 직무지도원 (0=무제한)</label>
                      <input type="number" min="0" value={editMaxWorkers} onChange={e=>setEditMaxWorkers(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
                    <div><label className="mb-1 block text-[11px] font-semibold text-slate-500">최대 현장 수 (0=무제한)</label>
                      <input type="number" min="0" value={editMaxSites} onChange={e=>setEditMaxSites(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold outline-none focus:border-sky-400"/></div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={()=>setEditId(null)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 active:scale-95">취소</button>
                    <button onClick={savePlan} disabled={processing} className="rounded-xl bg-slate-950 px-3 py-2 text-sm font-black text-white active:scale-95 disabled:opacity-60">{processing?"...":"저장"}</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 에이전시 상세 모달 */}
      {detailId && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 sm:p-8" onClick={() => setDetailId(null)}>
          <div className="my-auto w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl sm:p-8" onClick={e => e.stopPropagation()}>
            <div className="mb-2 flex justify-end">
              <button onClick={() => setDetailId(null)} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>
            <AgencyDetail id={detailId} onClose={() => setDetailId(null)} />
          </div>
        </div>
      )}

      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
