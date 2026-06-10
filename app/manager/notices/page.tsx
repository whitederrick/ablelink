"use client";

// 알림 목록 게시판 — 발송한 알림 이력을 게시판으로 열람. 상단 "+ 알림 발송" 버튼으로 발송(모달).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Send, Users, User, Building2, X } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";

const NOTICE_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  INFO:   { label: "안내", tone: "sky" },
  WARN:   { label: "주의", tone: "amber" },
  REJECT: { label: "반려", tone: "rose" },
};
const NOTICE_PAGE_SIZE = 10;

type Worker  = { id: string; workerName: string; siteName: string };
type Site    = { id: string; companyName: string };
type SendMode = "ALL" | "GROUP" | "INDIVIDUAL";
type Notice = { id: string; workerId: string; workerName: string; title: string; body: string; type: string; read: boolean; createdAt: string };

const TYPE_OPTS = [
  { val:"INFO",   label:"일반 안내",  cls:"bg-sky-100 text-sky-700" },
  { val:"WARN",   label:"주의/경고",  cls:"bg-amber-100 text-amber-700" },
  { val:"REJECT", label:"반려",       cls:"bg-rose-100 text-rose-700" },
];

// ── 알림 발송 모달 ──────────────────────────────────────────────
function SendModal({ workers, sites, onClose, onSent }: {
  workers: Worker[]; sites: Site[]; onClose: () => void; onSent: (n: number) => void;
}) {
  const [mode, setMode] = useState<SendMode>("ALL");
  const [selectedSite, setSelectedSite] = useState("");
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
  const [indivQuery, setIndivQuery] = useState("");
  const [indivSite, setIndivSite] = useState("");
  const [title, setTitle]   = useState("");
  const [body, setBody]     = useState("");
  const [type, setType]     = useState("INFO");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if(!title.trim()||!body.trim()){setError("제목과 내용을 입력해주세요.");return;}
    if(mode==="GROUP"&&!selectedSite){setError("현장을 선택해주세요.");return;}
    if(mode==="INDIVIDUAL"&&selectedWorkers.size===0){setError("직무지도원을 선택해주세요.");return;}
    setSending(true); setError("");
    const payload: any = { audience: mode, title: title.trim(), body: body.trim(), type };
    if(mode==="GROUP") payload.siteId = selectedSite;
    if(mode==="INDIVIDUAL") payload.userIds = [...selectedWorkers];
    try {
      const res = await fetch("/api/admin/notices",{ method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      const data = await res.json();
      if(!data.success) throw new Error(data.message || "발송 실패");
      onSent(data.sent); onClose();
    } catch(e:any){ setError(e.message); }
    finally { setSending(false); }
  }

  // 개별 발송: 검색 + 현장 필터로 조회(직무지도원이 많아도 체크박스 나열 대신 조회식)
  const indivSiteOptions = Array.from(new Set(workers.map(w => w.siteName).filter(Boolean)));
  const indivFiltered = workers.filter(w =>
    (!indivSite || w.siteName === indivSite) &&
    (!indivQuery.trim() || w.workerName.includes(indivQuery.trim()) || (w.siteName ?? "").includes(indivQuery.trim()))
  );
  const allFilteredSelected = indivFiltered.length > 0 && indivFiltered.every(w => selectedWorkers.has(w.id));
  function toggleAllFiltered() {
    setSelectedWorkers(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) indivFiltered.forEach(w => next.delete(w.id));
      else indivFiltered.forEach(w => next.add(w.id));
      return next;
    });
  }

  return (
    <div className={T.modalOverlay} onClick={() => !sending && onClose()}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">알림 발송</h2>
          <button onClick={() => !sending && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-1">
          {/* 수신 대상 */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
            <p className="mb-3 text-sm font-black text-slate-900">수신 대상</p>
            <div className="mb-3 flex gap-2">
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
              <select value={selectedSite} onChange={e=>setSelectedSite(e.target.value)} className={`w-full ${T.input}`}>
                <option value="">현장 선택…</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.companyName}</option>)}
              </select>
            )}
            {mode==="INDIVIDUAL"&&(
              <div className="space-y-2">
                {/* 조회: 이름 검색 + 현장 필터 (체크박스 나열 대신) */}
                <div className="flex gap-2">
                  <input value={indivQuery} onChange={e=>setIndivQuery(e.target.value)}
                    placeholder="이름·현장 검색" className={`flex-1 ${T.input}`} />
                  <select value={indivSite} onChange={e=>setIndivSite(e.target.value)} className={`w-40 ${T.input}`}>
                    <option value="">전체 현장</option>
                    {indivSiteOptions.map(s=><option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-slate-500">
                    선택 {selectedWorkers.size}명 · 조회 {indivFiltered.length}명
                  </span>
                  <button type="button" onClick={toggleAllFiltered}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600 hover:bg-slate-50">
                    {allFilteredSelected ? "조회결과 전체해제" : "조회결과 전체선택"}
                  </button>
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto">
                  {indivFiltered.length === 0 ? (
                    <p className="py-6 text-center text-sm font-semibold text-slate-400">조건에 맞는 직무지도원이 없습니다.</p>
                  ) : indivFiltered.map(c=>(
                    <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-100 bg-white px-3 py-2.5">
                      <input type="checkbox" checked={selectedWorkers.has(c.id)}
                        onChange={e=>{ const next = new Set(selectedWorkers); if(e.target.checked) next.add(c.id); else next.delete(c.id); setSelectedWorkers(next); }}
                        className="h-4 w-4 accent-slate-950"/>
                      <span className="text-sm font-semibold text-slate-800">{c.workerName}</span>
                      {c.siteName&&<span className="ml-auto text-xs text-slate-400">{c.siteName}</span>}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 유형 */}
          <div>
            <p className="mb-2 text-sm font-black text-slate-900">알림 유형</p>
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
          <div className="space-y-2">
            <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="제목 (100자 이내)" className={`w-full ${T.input}`}/>
            <textarea value={body} onChange={e=>setBody(e.target.value)} rows={4} placeholder="내용 (500자 이내)" className={`w-full resize-none py-2 ${T.input} h-auto`}/>
          </div>
        </div>

        {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => !sending && onClose()} className={T.btnSecondary}>취소</button>
          <button onClick={send} disabled={sending||!title.trim()||!body.trim()} className={`flex items-center gap-2 ${T.btnPrimary}`}>
            {sending?<><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"/>발송 중...</>:<><Send className="h-4 w-4"/>발송</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NoticesPage() {
  const [workers, setWorkers]   = useState<Worker[]>([]);
  const [sites, setSites]       = useState<Site[]>([]);
  const [notices, setNotices]   = useState<Notice[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [toast, setToast]       = useState("");

  // 조회조건
  const [query, setQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(()=>setToast(""),3000); };

  const loadNotices = useCallback(()=>{
    fetch("/api/admin/notices?limit=100").then(r=>r.json())
      .then(d=>{ if(d.success) setNotices(d.notices); }).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{
    fetch("/api/admin/workers?pageSize=200").then(r=>r.json())
      .then(d=>{ if(d.success) setWorkers(d.data?.map((c:any)=>({id:c.id,workerName:c.workerName,siteName:c.currentSiteName??c.siteName??""}))||[]); }).catch(()=>{});
    fetch("/api/admin/sites?pageSize=200").then(r=>r.json())
      .then(d=>{ if(d.success) setSites((d.items||[]).map((s:any)=>({id:String(s.id),companyName:s.companyName}))); }).catch(()=>{});
    loadNotices();
  },[loadNotices]);

  const stats = useMemo(() => ({
    total: notices.length,
    unread: notices.filter(n => !n.read).length,
    read: notices.filter(n => n.read).length,
  }), [notices]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notices
      .filter(n => selectedTypes.length === 0 || selectedTypes.includes(n.type))
      .filter(n => readFilter === "all" || (readFilter === "unread" ? !n.read : n.read))
      .filter(n => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q) || (n.workerName ?? "").toLowerCase().includes(q));
  }, [notices, query, selectedTypes, readFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / NOTICE_PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * NOTICE_PAGE_SIZE, page * NOTICE_PAGE_SIZE);
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);
  const selected = notices.find(n => n.id === selectedId) ?? null;

  const filters: FilterChip[] = TYPE_OPTS.map(o => ({
    value: o.val, label: o.label, count: notices.filter(n => n.type === o.val).length,
  }));
  const toggleType = (v: string) => { setPage(1); setSelectedTypes(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]); };

  return (
    <div>
      <PageHeader
        title="알림 목록"
        sub="직무지도원에게 발송한 알림(전체·현장 그룹·개별) 이력입니다. 새 알림은 ‘알림 발송’으로 보냅니다."
        actions={<button onClick={()=>setShowSend(true)} className={T.btnPrimary}>+ 알림 발송</button>}
      />

      <StatCardRow
        className="mb-5"
        cols={3}
        items={[
          { label: "전체 알림", value: stats.total },
          { label: "미확인", value: stats.unread, tone: "rose" },
          { label: "확인 완료", value: stats.read, tone: "emerald" },
        ]}
      />

      <div className="mb-4">
        <ListToolbar
          query={query}
          onQueryChange={v => { setQuery(v); setPage(1); }}
          placeholder="제목·내용·수신자 검색"
          filters={filters}
          selected={selectedTypes}
          onToggleFilter={toggleType}
          extra={
            <div className="flex gap-1">
              {([["all","전체"],["unread","미확인"],["read","확인"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => { setReadFilter(v); setPage(1); }}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
                    readFilter === v ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}>
                  {label}
                </button>
              ))}
            </div>
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 목록 — 컴팩트 단일라인 행 */}
        <div>
          <div className="space-y-1.5">
            {loading ? (
              <p className={T.empty}>불러오는 중…</p>
            ) : notices.length===0 ? (
              <div className="flex h-40 items-center justify-center rounded-2xl border border-slate-100 bg-white">
                <p className="text-sm font-semibold text-slate-400">발송한 알림이 없습니다. ‘+ 알림 발송’으로 보내보세요.</p>
              </div>
            ) : pageItems.length===0 ? (
              <p className={T.empty}>조건에 맞는 알림이 없습니다.</p>
            ) : pageItems.map(n=>(
                <button key={n.id} onClick={() => setSelectedId(n.id)}
                  className={`flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-left transition hover:border-slate-300 ${selectedId === n.id ? "border-slate-950 ring-1 ring-slate-200" : "border-slate-200"}`}>
                  <StatusBadge status={n.type} map={NOTICE_BADGE} />
                  {n.read
                    ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-600">확인</span>
                    : <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-600">미확인</span>}
                  <span className={`flex-1 truncate text-[15px] ${n.read ? "font-semibold text-slate-700" : "font-black text-slate-900"}`}>{n.title}</span>
                  <span className="shrink-0 max-w-[96px] truncate text-[13px] font-semibold text-slate-500">{n.workerName}</span>
                  <span className="shrink-0 w-[72px] text-right text-xs font-semibold text-slate-400">{n.createdAt.slice(2, 10)}</span>
                </button>
            ))}
          </div>
          {filtered.length > 0 && (
            <Pagination className="mt-4" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
          )}
        </div>

        {/* 상세(우측 패널) */}
        <div className="lg:sticky lg:top-4 h-fit">
          {selected ? (
            <div className={T.card}>
              <div className="mb-2 flex items-center gap-1.5">
                <StatusBadge status={selected.type} map={NOTICE_BADGE} />
                {selected.read
                  ? <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-600">확인</span>
                  : <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-black text-rose-600">미확인</span>}
                <span className="ml-auto text-[11px] font-semibold text-slate-300">{selected.createdAt.slice(0, 10)}</span>
              </div>
              <p className="text-base font-black text-slate-900">{selected.title}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500">수신: {selected.workerName}</p>
              <p className="mt-2 whitespace-pre-line text-sm font-semibold leading-relaxed text-slate-600">{selected.body}</p>
            </div>
          ) : (
            <div className={`${T.card} text-center`}>
              <p className="py-6 text-sm font-semibold text-slate-300">목록에서 알림을 선택하면<br />상세 내용이 표시됩니다.</p>
            </div>
          )}
        </div>
      </div>

      {showSend && <SendModal workers={workers} sites={sites} onClose={()=>setShowSend(false)} onSent={(n)=>{ showToast(`${n}명에게 발송했습니다.`); loadNotices(); }} />}
      {toast&&<div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white shadow-lg">{toast}</div>}
    </div>
  );
}
