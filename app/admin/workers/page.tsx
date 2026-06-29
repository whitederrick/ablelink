"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
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
// 구독 유형 — violet 금지(피드백): FREE=slate, 유료=sky/emerald
const PLAN_MAP: Record<string, { label: string; tone: BadgeTone }> = {
  FREE:     { label: "구독 없음", tone: "slate" },
  STARTER:  { label: "STARTER",  tone: "sky" },
  STANDARD: { label: "STANDARD", tone: "sky" },
  PRO:      { label: "PRO",      tone: "emerald" },
  PREMIUM:  { label: "PRO",      tone: "emerald" },
};
const PAGE_SIZE = 10;

export default function WorkersPage() {
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [loading, setLoading]   = useState(true);
  const [q, setQ]               = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage]         = useState(1);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast]       = useState("");

  // 신규 생성(promo 온보딩)
  const [creating, setCreating] = useState(false);
  const [cName, setCName]       = useState("");
  const [cPhone, setCPhone]     = useState("");
  const [cPw, setCPw]           = useState("");
  const [cPlan, setCPlan]       = useState("FREE");

  // 상세 모달
  const [detailId, setDetailId] = useState<string|null>(null);
  const [editPlan, setEditPlan]   = useState("FREE"); const [planMemo, setPlanMemo] = useState("");
  const [editStatus, setEditStatus] = useState("ACTIVE"); const [statusMemo, setStatusMemo] = useState("");
  const [newPw, setNewPw]       = useState("");

  // 현장 배정(상세 모달에서 호출)
  const [assignFor, setAssignFor] = useState<{id:string;name:string}|null>(null);
  const [assignSites, setAssignSites] = useState<{id:string;companyName:string;agencyName:string|null}[]>([]);
  const [assignSelected, setAssignSelected] = useState<{id:string;companyName:string}|null>(null);
  const [assignQ, setAssignQ]   = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignStart, setAssignStart] = useState("");
  const [assignEnd, setAssignEnd]     = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  // 배정 API 원시 에러코드 → 사용자 메시지
  function assignErr(m?: string) {
    if (!m) return "배정에 실패했습니다.";
    if (m === "FORBIDDEN") return "이 현장에 배정할 권한이 없습니다. (다른 위탁기관 소속 현장일 수 있습니다)";
    if (m === "NOT_FOUND") return "대상을 찾을 수 없습니다.";
    if (m === "VALIDATION:siteInactive") return "비활성 현장에는 배정할 수 없습니다.";
    if (m === "VALIDATION:userInactive") return "비활성 직무지도원은 배정할 수 없습니다.";
    if (m.startsWith("VALIDATION:")) return "입력값을 확인해주세요.";
    return m; // 서버가 내려준 한글 메시지(중복·다른 현장 배정 등)는 그대로
  }

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

  const detail = useMemo(()=>workers.find(w=>w.id===detailId)??null,[workers,detailId]);
  const [activeAsg, setActiveAsg] = useState<{id:string;siteName:string|null;status:string}|null>(null);
  function openDetail(w:Worker){ setDetailId(w.id); setEditPlan(w.planType||"FREE"); setPlanMemo(""); setEditStatus(w.status); setStatusMemo(""); setNewPw(""); }
  function closeDetail(){ setDetailId(null); setActiveAsg(null); }

  const loadActiveAsg = useCallback((workerId:string)=>{
    fetch(`/api/admin/assignments?workerId=${workerId}`, { headers: { "x-admin-context": "1" }, cache: "no-store" })
      .then(r=>r.json())
      .then(d=>{
        const a = d.success ? (d.items||[]).find((x:any)=>["ASSIGNED","CONFIRMED","ACTIVE"].includes(x.status)) : null;
        setActiveAsg(a ? { id:a.id, siteName:a.site?.companyName ?? null, status:a.status } : null);
      }).catch(()=>setActiveAsg(null));
  },[]);
  useEffect(()=>{ if(detailId) loadActiveAsg(detailId); else setActiveAsg(null); },[detailId,loadActiveAsg]);

  async function cancelAsg(asgId:string){
    if(!confirm("이 배정을 취소(종료)하시겠습니까? 종료 후 다른 현장으로 재배정할 수 있습니다.")) return;
    setProcessing(true);
    const res=await fetch(`/api/admin/assignments/${asgId}`,{method:"DELETE",headers:{"x-admin-context":"1"}});
    const d=await res.json(); setProcessing(false);
    if(d.success){ showToast(d.message); if(detailId) loadActiveAsg(detailId); load(); }
    else showToast(d.message||"취소 실패");
  }

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

  async function patch(id:string, body:any){
    setProcessing(true);
    const res=await fetch(`/api/admin/system/workers/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await res.json(); setProcessing(false);
    return data;
  }
  async function savePlan(){ if(!detail)return; const d=await patch(detail.id,{action:"set-plan",planType:editPlan,memo:planMemo}); if(d.success){showToast(d.message);setPlanMemo("");load();}else showToast(d.message||"실패"); }
  async function saveStatus(){ if(!detail)return; const d=await patch(detail.id,{action:"set-status",status:editStatus,memo:statusMemo}); if(d.success){showToast(d.message);setStatusMemo("");load();}else showToast(d.message||"실패"); }
  async function resetPw(){ if(!detail)return; if(newPw.length<8){showToast("8자 이상 입력하세요.");return;} const d=await patch(detail.id,{action:"reset-password",newPassword:newPw}); if(d.success){showToast(d.message);setNewPw("");}else showToast(d.message||"실패"); }

  const loadSites=useCallback((query="")=>{
    setAssignLoading(true);
    fetch(`/api/admin/system/sites?q=${encodeURIComponent(query)}`)
      .then(r=>r.json()).then(d=>{if(d.success)setAssignSites(d.sites.filter((s:any)=>s.agencyId));}).catch(()=>{}).finally(()=>setAssignLoading(false));
  },[]);
  function openAssign(c:{id:string;name:string}){
    setAssignFor(c); setAssignQ(""); setAssignSelected(null);
    const t=new Date(); setAssignStart(`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`); setAssignEnd("");
    loadSites("");
  }
  async function doAssign(siteId:string){
    if(!assignFor)return;
    if(assignStart&&assignEnd&&assignStart>assignEnd){showToast("계약 시작일이 종료일보다 늦습니다.");return;}
    setProcessing(true);
    const res=await fetch("/api/admin/assignments",{method:"POST",headers:{"Content-Type":"application/json","x-admin-context":"1"},
      body:JSON.stringify({siteId,workerId:assignFor.id,startDate:assignStart||undefined,endDate:assignEnd||undefined})});
    const data=await res.json(); setProcessing(false);
    if(data.success){showToast("현장에 배정되었습니다.");setAssignFor(null);setAssignSelected(null);if(detailId)loadActiveAsg(detailId);load();}
    else showToast(assignErr(data.message));
  }

  const cnt = (s:string)=>workers.filter(w=>w.status===s).length;
  const COLS = ["성명","아이디(전화번호)","소속 위탁기관","현장","구독 유형","상태"];

  return (
    <div>
      <PageHeader
        title="직무지도원 현황 관리"
        sub="직무지도원 계정을 조회합니다. 목록에서 직무지도원을 선택하면 비밀번호 초기화·상태 변경·구독 등급·현장 배정을 진행할 수 있습니다."
        actions={<button onClick={()=>setCreating(true)} className={T.btnPrimary}>+ 직무지도원 등록</button>}
      />

      <StatCardRow
        className="mb-5"
        cols={4}
        items={[
          { label: "전체", value: workers.length },
          { label: "활성", value: cnt("ACTIVE"), tone: "emerald" },
          { label: "일시정지", value: cnt("PAUSED"), tone: "amber" },
          { label: "퇴직", value: cnt("RESIGNED"), tone: "rose" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={q}
          onQueryChange={setQ}
          placeholder="이름·전화번호·아이디·위탁기관 검색"
          filters={[
            { value: "ACTIVE", label: "활성", count: cnt("ACTIVE") },
            { value: "PAUSED", label: "일시정지", count: cnt("PAUSED") },
            { value: "RESIGNED", label: "퇴직", count: cnt("RESIGNED") },
          ] as FilterChip[]}
          selected={statusFilter}
          onToggleFilter={(v)=>setStatusFilter(p=>p.includes(v)?p.filter(x=>x!==v):[...p,v])}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[840px] table-fixed border-collapse">
          <colgroup>
            <col className="w-[130px]" />{/* 성명 */}
            <col className="w-[150px]" />{/* 아이디(전화번호) */}
            <col className="w-[180px]" />{/* 소속 위탁기관 */}
            <col className="w-[160px]" />{/* 현장 */}
            <col className="w-[110px]" />{/* 구독 유형 */}
            <col className="w-[90px]" />{/* 상태 */}
          </colgroup>
          <thead>
            <tr>{COLS.map(h=><th key={h} className={T.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading?(
              <tr><td colSpan={COLS.length} className={T.tdCenter}>로딩 중...</td></tr>
            ):filtered.length===0?(
              <tr><td colSpan={COLS.length} className={T.tdCenter}>{workers.length===0?"직무지도원이 없습니다.":"조건에 맞는 직무지도원이 없습니다."}</td></tr>
            ):pageItems.map(c=>(
              <tr key={c.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50 ${c.status!=="ACTIVE"?"opacity-60":""}`} onClick={()=>openDetail(c)}>
                <td className={`${T.td} truncate`}><span className="font-bold text-sky-600">{c.workerName}</span></td>
                <td className={`${T.td} truncate`}>{c.phoneNumber || c.loginId}</td>
                <td className={`${T.td} truncate`}>{c.agencyName || <span className="text-slate-400">미배정</span>}</td>
                <td className={`${T.td} truncate`}>{c.siteName || <span className="text-slate-400">없음</span>}</td>
                <td className={T.td}><StatusBadge status={c.planType||"FREE"} map={PLAN_MAP} /></td>
                <td className={T.td}><StatusBadge status={c.status} map={WK_BADGE} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length>0 && (
        <Pagination className="pt-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      )}

      {/* 직무지도원 등록 모달 */}
      {creating&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-5">
          <div className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-1 text-base font-black text-slate-900">직무지도원 등록</p>
            <p className="mb-4 text-xs font-semibold leading-relaxed text-slate-400">자가가입 종료에 따라 운영자가 직접 발급(promo 온보딩). 전화번호가 로그인 아이디가 됩니다.</p>
            <input value={cName} onChange={e=>setCName(e.target.value)} placeholder="이름"
              className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <input value={cPhone} onChange={e=>setCPhone(e.target.value.replace(/[^0-9]/g,""))} inputMode="numeric" placeholder="휴대전화번호 (아이디)"
              className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <input type="text" value={cPw} onChange={e=>setCPw(e.target.value)} placeholder="임시 비밀번호 (8자 이상)"
              className="mb-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-sky-400"/>
            <select value={cPlan} onChange={e=>setCPlan(e.target.value)}
              className="mb-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold outline-none">
              <option value="FREE">등급: 구독 없음</option>
              <option value="STARTER">등급: STARTER</option>
              <option value="STANDARD">등급: STANDARD</option>
              <option value="PRO">등급: PRO (전체)</option>
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

      {/* 상세 모달 — 수정·비활성·등급·배정 */}
      {detail&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-5" onClick={closeDetail}>
          <div className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900">{detail.workerName}</h2>
              <StatusBadge status={detail.status} map={WK_BADGE} />
              <StatusBadge status={detail.planType||"FREE"} map={PLAN_MAP} />
            </div>
            <div className="mb-5 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div><span className="text-slate-400">아이디(전화번호) </span><span className="font-semibold text-slate-800">{detail.phoneNumber || detail.loginId}</span></div>
              <div><span className="text-slate-400">가입일 </span><span className="font-semibold text-slate-800">{new Date(detail.createdAt).toLocaleDateString("ko-KR")}</span></div>
              <div><span className="text-slate-400">소속 위탁기관 </span><span className="font-semibold text-slate-800">{detail.agencyName || "미배정"}</span></div>
              <div><span className="text-slate-400">현장 </span><span className="font-semibold text-slate-800">{detail.siteName || "없음"}</span></div>
            </div>

            <div className="space-y-3">
              {/* 구독 등급 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                <p className="mb-2 text-sm font-black text-slate-700">구독 등급 부여</p>
                <p className="mb-2 text-[11px] text-slate-400">위탁기관 계약과 무관하게 개인에게 직접 부여(초기 영업·특례용). FREE=회수.</p>
                <div className="flex gap-2">
                  <select value={editPlan} onChange={e=>setEditPlan(e.target.value)} className={`${T.select} flex-1`}>
                    <option value="FREE">구독 없음 (등급 회수)</option>
                    <option value="STARTER">STARTER</option>
                    <option value="STANDARD">STANDARD</option>
                    <option value="PRO">PRO (전체)</option>
                  </select>
                  <button onClick={savePlan} disabled={processing} className={`${T.btnPrimary} shrink-0`}>저장</button>
                </div>
                <input value={planMemo} onChange={e=>setPlanMemo(e.target.value)} placeholder="부여 사유 (감사 로그)"
                  className={`${T.input} mt-2 w-full`} />
              </div>

              {/* 상태 변경 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                <p className="mb-2 text-sm font-black text-slate-700">상태 변경 (비활성/퇴직)</p>
                <div className="flex gap-2">
                  <select value={editStatus} onChange={e=>setEditStatus(e.target.value)} className={`${T.select} flex-1`}>
                    <option value="ACTIVE">ACTIVE (활성)</option>
                    <option value="PAUSED">PAUSED (일시정지)</option>
                    <option value="RESIGNED">RESIGNED (퇴직)</option>
                  </select>
                  <button onClick={saveStatus} disabled={processing} className={`${T.btnPrimary} shrink-0`}>저장</button>
                </div>
                <input value={statusMemo} onChange={e=>setStatusMemo(e.target.value)} placeholder="변경 사유 (감사 로그)"
                  className={`${T.input} mt-2 w-full`} />
              </div>

              {/* 비밀번호 초기화 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                <p className="mb-2 text-sm font-black text-slate-700">비밀번호 초기화</p>
                <div className="flex gap-2">
                  <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="새 비밀번호 (8자 이상)" className={`${T.input} flex-1`} />
                  <button onClick={resetPw} disabled={processing} className={`${T.btnSecondary} shrink-0`}>초기화</button>
                </div>
              </div>

              {/* 현장 배정 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-3.5">
                <p className="mb-2 text-sm font-black text-slate-700">현장 배정</p>
                {activeAsg ? (
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 text-sm"><span className="text-slate-400">현재 배정 </span><span className="font-semibold text-slate-800">{activeAsg.siteName ?? "-"}</span></p>
                    <button onClick={()=>cancelAsg(activeAsg.id)} disabled={processing} className={`${T.btnDanger} shrink-0`}>배정 취소</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-400">현재 배정된 현장이 없습니다. 계약기간을 입력하고 현장을 선택해 배정합니다.</p>
                    <button onClick={()=>openAssign({id:detail.id,name:detail.workerName})} className={`${T.btnSecondary} shrink-0`}>배정하기</button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
              <button onClick={closeDetail} className={T.btnSecondary}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 현장 배정 모달(상세 위에) */}
      {assignFor&&(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 px-5">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl bg-white p-6 shadow-2xl">
            <p className="mb-1 text-base font-black text-slate-900">현장 배정</p>
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
            <p className="mb-1.5 text-[11px] font-semibold text-slate-400">배정할 현장 1곳을 선택한 뒤 아래 "배정 확정"을 누르세요.</p>
            <div className="flex-1 overflow-y-auto rounded-xl border border-slate-100">
              {assignLoading?(
                <p className="py-8 text-center text-sm text-slate-400">불러오는 중...</p>
              ):assignSites.length===0?(
                <p className="py-8 text-center text-sm text-slate-400">현장이 없습니다.</p>
              ):assignSites.map(s=>{
                const sel = assignSelected?.id===s.id;
                return (
                  <button key={s.id} onClick={()=>setAssignSelected({id:s.id,companyName:s.companyName})}
                    className={`flex w-full items-center justify-between border-b border-slate-50 px-3 py-2.5 text-left last:border-b-0 transition ${sel?"bg-sky-50":"hover:bg-slate-50"}`}>
                    <span className="flex items-center gap-2">
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${sel?"border-sky-500 bg-sky-500":"border-slate-300"}`}>
                        {sel && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                      <span className="text-sm font-semibold text-slate-800">{s.companyName}</span>
                    </span>
                    <span className="text-xs text-slate-400">{s.agencyName ?? "-"}</span>
                  </button>
                );
              })}
            </div>
            {assignSelected && (
              <p className="mt-2 text-[12px] font-semibold text-slate-600">선택: <span className="text-sky-600">{assignSelected.companyName}</span></p>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={()=>setAssignFor(null)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600 active:scale-95">닫기</button>
              <button onClick={()=>{ if(assignSelected) doAssign(assignSelected.id); }} disabled={processing||!assignSelected}
                className="flex-1 rounded-xl bg-slate-950 py-2.5 text-sm font-black text-white active:scale-95 disabled:opacity-50">{processing?"배정 중...":"배정 확정"}</button>
            </div>
          </div>
        </div>
      )}

      {toast&&<div className="fixed bottom-8 left-1/2 z-[100] -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
