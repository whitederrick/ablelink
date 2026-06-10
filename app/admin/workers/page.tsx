"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { KeyRound, UserX, UserCheck } from "lucide-react";
import PageHeader from "../_components/PageHeader";
import { T } from "../_styles";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

type Worker = {
  id: string; loginId: string; workerName: string; phoneNumber: string;
  status: string; planType: string; siteName: string|null;
  agencyId: string|null; agencyName: string|null; createdAt: string;
};

const WK_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE: { label: "활성", tone: "emerald" },
  PAUSED: { label: "일시정지", tone: "amber" },
  RESIGNED: { label: "퇴직", tone: "rose" },
};
const PAGE_SIZE = 20;

export default function WorkersPage() {
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [loading, setLoading]   = useState(true);
  const [q, setQ]               = useState("");
  const [actionId, setActionId] = useState<string|null>(null);
  const [actionType, setActionType] = useState<"pw"|"status"|"plan"|null>(null);
  const [newPw, setNewPw]       = useState("");
  const [newStatus, setNewStatus] = useState("RESIGNED");
  const [newPlan, setNewPlan]   = useState("FREE");
  const [memo, setMemo]         = useState("");
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");
  // 신규 생성(promo 온보딩)
  const [creating, setCreating] = useState(false);
  const [cName, setCName]       = useState("");
  const [cPhone, setCPhone]     = useState("");
  const [cPw, setCPw]           = useState("");
  const [cPlan, setCPlan]       = useState("FREE");
  // 사이트 배정
  const [assignFor, setAssignFor] = useState<{id:string;name:string}|null>(null);
  const [assignSites, setAssignSites] = useState<{id:string;companyName:string;agencyName:string|null}[]>([]);
  const [assignQ, setAssignQ]   = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignStart, setAssignStart] = useState("");
  const [assignEnd, setAssignEnd]     = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  async function doCreate(){
    if(cName.trim().length<2){showToast("이름은 2자 이상");return;}
    if(!/^01[0-9]{8,9}$/.test(cPhone.replace(/-/g,""))){showToast("올바른 휴대전화번호를 입력하세요.");return;}
    if(cPw.length<8){showToast("임시 비밀번호는 8자 이상");return;}
    setProcessing(true);
    const res=await fetch("/api/admin/system/workers",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({workerName:cName.trim(),phoneNumber:cPhone.replace(/-/g,""),password:cPw,planType:cPlan})});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast(data.message);setCreating(false);setCName("");setCPhone("");setCPw("");setCPlan("FREE");load();}
    else showToast(data.message||"생성 실패");
  }

  const loadSites=useCallback((query="")=>{
    setAssignLoading(true);
    fetch(`/api/admin/system/sites?q=${encodeURIComponent(query)}`)
      .then(r=>r.json()).then(d=>{if(d.success)setAssignSites(d.sites.filter((s:any)=>s.agencyId));}).catch(()=>{}).finally(()=>setAssignLoading(false));
  },[]);
  function openAssign(c:Worker){
    setAssignFor({id:c.id,name:c.workerName}); setAssignQ("");
    const t=new Date(); setAssignStart(`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`); setAssignEnd("");
    loadSites("");
  }
  async function doAssign(siteId:string){
    if(!assignFor)return;
    if(assignStart&&assignEnd&&assignStart>assignEnd){showToast("계약 시작일이 종료일보다 늦습니다.");return;}
    setProcessing(true);
    const res=await fetch("/api/admin/assignments",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({siteId,workerId:assignFor.id,startDate:assignStart||undefined,endDate:assignEnd||undefined})});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast("사이트에 배정되었습니다.");setAssignFor(null);load();}
    else showToast(data.message||"배정 실패");
  }
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const load = useCallback(()=>{
    setLoading(true);
    fetch(`/api/admin/system/workers`)
      .then(r=>r.json()).then(d=>{if(d.success)setWorkers(d.workers);}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);
  useEffect(()=>{load();},[load]);

  const filtered = useMemo(()=>{
    const query = q.trim().toLowerCase();
    return workers
      .filter(w => statusFilter.length===0 || statusFilter.includes(w.status))
      .filter(w => !query || w.workerName.toLowerCase().includes(query) || (w.phoneNumber??"").includes(query) || (w.loginId??"").toLowerCase().includes(query) || (w.agencyName??"").toLowerCase().includes(query));
  },[workers,q,statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length/PAGE_SIZE));
  const pageItems = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);
  useEffect(()=>{setPage(1);},[q,statusFilter]);

  async function doAction(){
    if(!actionId||!actionType)return;
    setProcessing(true);
    let body: any;
    if(actionType==="pw"){
      if(newPw.length<8){showToast("8자 이상 입력하세요.");setProcessing(false);return;}
      body={action:"reset-password",newPassword:newPw};
    } else if(actionType==="plan"){
      body={action:"set-plan",planType:newPlan,memo};
    } else {
      body={action:"set-status",status:newStatus,memo};
    }
    const res=await fetch(`/api/admin/system/workers/${actionId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast(data.message);setActionId(null);setActionType(null);setNewPw("");setMemo("");load();}
    else showToast(data.message||"실패");
  }

  return (
    <div>
      <PageHeader
        title="전체 직무지도원"
        sub="비밀번호 초기화·상태 변경·등급 부여·사이트 배정"
        actions={
          <button onClick={()=>setCreating(true)} className={`${T.btnPrimary}`}>+ 신규 직무지도원</button>
        }
      />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체", value: workers.length },
          { label: "활성", value: workers.filter(w=>w.status==="ACTIVE").length, tone: "emerald" },
          { label: "일시정지", value: workers.filter(w=>w.status==="PAUSED").length, tone: "amber" },
          { label: "퇴직", value: workers.filter(w=>w.status==="RESIGNED").length, tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="이름·전화번호·아이디·에이전시 검색"
          filters={[
            { value: "ACTIVE", label: "활성", count: workers.filter(w=>w.status==="ACTIVE").length },
            { value: "PAUSED", label: "일시정지", count: workers.filter(w=>w.status==="PAUSED").length },
            { value: "RESIGNED", label: "퇴직", count: workers.filter(w=>w.status==="RESIGNED").length },
          ] as FilterChip[]}
          selected={statusFilter}
          onToggleFilter={(v)=>setStatusFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      {creating&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-1 text-base font-black text-slate-900">신규 직무지도원 생성</p>
            <p className="mb-4 text-xs font-semibold leading-relaxed text-slate-400">자가가입 종료에 따라 운영자가 직접 발급(promo 온보딩). 전화번호가 로그인 아이디가 됩니다.</p>
            <input value={cName} onChange={e=>setCName(e.target.value)} placeholder="이름"
              className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <input value={cPhone} onChange={e=>setCPhone(e.target.value.replace(/[^0-9]/g,""))} inputMode="numeric" placeholder="휴대전화번호 (아이디)"
              className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <input type="text" value={cPw} onChange={e=>setCPw(e.target.value)} placeholder="임시 비밀번호 (8자 이상)"
              className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <select value={cPlan} onChange={e=>setCPlan(e.target.value)}
              className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none">
              <option value="FREE">등급: FREE</option>
              <option value="STARTER">등급: STARTER</option>
              <option value="STANDARD">등급: STANDARD</option>
              <option value="PRO">등급: PRO</option>
              <option value="PREMIUM">등급: PREMIUM (전체)</option>
            </select>
            <div className="flex gap-2">
              <button onClick={()=>{setCreating(false);setCName("");setCPhone("");setCPw("");setCPlan("FREE");}}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">취소</button>
              <button onClick={doCreate} disabled={processing}
                className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-60">{processing?"...":"생성"}</button>
            </div>
          </div>
        </div>
      )}

      {actionId&&actionType&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-4 text-base font-black text-slate-900">{actionType==="pw"?"비밀번호 초기화":actionType==="plan"?"구독 등급 부여":"상태 변경"}</p>
            {actionType==="pw"?(
              <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="새 비밀번호 (8자 이상)"
                className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            ):actionType==="plan"?(
              <>
                <p className="mb-2 text-xs font-semibold leading-relaxed text-slate-400">
                  에이전시 계약과 무관하게 개인에게 직접 부여하는 등급입니다(초기 영업·특례용). FREE=회수.
                </p>
                <select value={newPlan} onChange={e=>setNewPlan(e.target.value)}
                  className="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none">
                  <option value="FREE">FREE (회수)</option>
                  <option value="STARTER">STARTER</option>
                  <option value="STANDARD">STANDARD</option>
                  <option value="PRO">PRO</option>
                  <option value="PREMIUM">PREMIUM (전체)</option>
                </select>
                <textarea value={memo} onChange={e=>setMemo(e.target.value)} rows={2} placeholder="부여 사유 (감사 로그 기록)"
                  className="mb-4 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold outline-none"/>
              </>
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

      {assignFor&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-1 text-base font-black text-slate-900">사이트 배정</p>
            <p className="mb-3 text-xs font-semibold text-slate-400">{assignFor.name} 님의 계약기간을 입력하고 배정할 현장을 선택하세요.</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-400">계약 시작</label>
                <input type="date" value={assignStart} max={assignEnd||undefined} onChange={e=>setAssignStart(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold text-slate-400">계약 종료(선택)</label>
                <input type="date" value={assignEnd} min={assignStart||undefined} onChange={e=>setAssignEnd(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-2 text-sm font-semibold outline-none focus:border-sky-400"/>
              </div>
            </div>
            <p className="mb-2 text-[11px] font-semibold text-slate-400">종료일을 비우면 무기한(진행 중). 이 기간이 유료기능 접근 판정의 계약기간이 됩니다.</p>
            <input value={assignQ} onChange={e=>{setAssignQ(e.target.value);loadSites(e.target.value);}} placeholder="현장명 검색..."
              className="mb-3 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <div className="flex-1 overflow-y-auto rounded-xl border border-slate-100">
              {assignLoading?(
                <p className="py-8 text-center text-sm text-slate-400">불러오는 중...</p>
              ):assignSites.length===0?(
                <p className="py-8 text-center text-sm text-slate-400">현장이 없습니다.</p>
              ):assignSites.map(s=>(
                <button key={s.id} onClick={()=>doAssign(s.id)} disabled={processing}
                  className="flex w-full items-center justify-between border-b border-slate-50 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-50">
                  <span className="text-sm font-semibold text-slate-800">{s.companyName}</span>
                  <span className="text-xs text-slate-400">{s.agencyName ?? "-"}</span>
                </button>
              ))}
            </div>
            <button onClick={()=>setAssignFor(null)}
              className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">닫기</button>
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
              {filtered.length===0?(<tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">{workers.length===0?"직무지도원이 없습니다.":"조건에 맞는 직무지도원이 없습니다."}</td></tr>)
              :pageItems.map(c=>(
                <tr key={c.id} className={`hover:bg-slate-50 transition ${c.status!=="ACTIVE"?"opacity-60":""}`}>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">{c.workerName} <span className="text-[13px] text-slate-500">({c.loginId})</span></td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">{c.phoneNumber}</td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">{c.agencyName || <span className="text-slate-400">미배정</span>}</td>
                  <td className="px-4 py-3 text-[15px] font-medium text-slate-800">{c.siteName || <span className="text-slate-400">없음</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={c.status} map={WK_BADGE} />
                      {c.planType && c.planType!=="FREE" && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[13px] font-black text-indigo-700">{c.planType}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <button onClick={()=>{setActionId(c.id);setActionType("pw");}} title="비밀번호 초기화"
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 active:scale-95"><KeyRound className="h-4 w-4"/></button>
                      <button onClick={()=>{setActionId(c.id);setActionType("status");setNewStatus(c.status==="ACTIVE"?"RESIGNED":"ACTIVE");}} title="상태 변경"
                        className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 active:scale-95">
                        {c.status==="ACTIVE"?<UserX className="h-4 w-4 text-rose-500"/>:<UserCheck className="h-4 w-4 text-emerald-600"/>}
                      </button>
                      <button onClick={()=>{setActionId(c.id);setActionType("plan");setNewPlan(c.planType||"FREE");}} title="구독 등급 부여"
                        className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-[13px] font-bold text-indigo-600 hover:bg-slate-50 active:scale-95">등급</button>
                      <button onClick={()=>openAssign(c)} title="사이트 배정"
                        className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-3 text-[13px] font-bold text-sky-600 hover:bg-slate-50 active:scale-95">배정</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
        </div>
      )}
      {toast&&<div className="fixed bottom-8 left-1/2 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg z-50">{toast}</div>}
    </div>
  );
}
