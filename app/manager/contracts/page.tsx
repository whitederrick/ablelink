"use client";

import { useEffect, useRef, useState } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import { X } from "lucide-react";
import { computeWorkTimes, type WorkType } from "@/lib/workSchedule";

// 근무형태별 휴게시간 프리셋(근무 4h 후 30분 / 전일 점심 1h). 수동 수정 가능.
const BREAK_PRESETS: Record<Exclude<WorkType, "CUSTOM">, { start: string; end: string }> = {
  AM: { start: "13:00", end: "13:30" },
  PM: { start: "17:00", end: "17:30" },
  FULL_DAY: { start: "12:00", end: "13:00" },
};
const WORK_TYPE_OPTIONS: { value: WorkType; label: string }[] = [
  { value: "AM", label: "오전 4H" },
  { value: "PM", label: "오후 4H" },
  { value: "FULL_DAY", label: "전일 8H" },
  { value: "CUSTOM", label: "직접입력" },
];

// 표준 특약 라이브러리(법적 기본 세트, 참고용 — 사업장별 검토 필요).
// "표준 특약 불러오기" 클릭 시 미등록(제목 기준) 조항만 일괄 생성.
const STANDARD_CLAUSES: { title: string; body: string }[] = [
  {
    title: "연차·월차 휴가(매월 정산)",
    body: "근로기준법에 따라 발생하는 연차·월차 유급휴가 미사용분은 매월 급여 지급 시 정산하여 지급한다.",
  },
  {
    title: "연차·월차 휴가(계약 종료 시 일괄정산)",
    body: "근로기준법에 따라 발생하는 연차·월차 유급휴가 미사용분은 계약 종료 시 일괄 정산하여 지급한다.",
  },
  {
    title: "마지막 달 월차 미발생",
    body: "계약 종료일이 속한 달의 개근에 따른 월차(연차) 휴가는 그 다음 달 근로가 예정되어 있지 아니하므로 발생·지급하지 아니한다.",
  },
  {
    title: "4대보험 가입",
    body: "근로자는 국민연금·국민건강보험·고용보험·산업재해보상보험에 가입하며, 법령에서 정한 근로자 부담분은 매월 임금에서 공제한다.",
  },
  {
    title: "수습기간",
    body: "근로 개시일부터 3개월간을 수습기간으로 하며, 수습기간 중에도 최저임금의 100분의 90 이상을 지급한다. 다만 1년 미만 계약 또는 단순노무 종사자에게는 수습기간 감액을 적용하지 아니한다.",
  },
  {
    title: "비밀유지 및 개인정보 보호",
    body: "근로자는 업무 수행 중 알게 된 훈련생의 개인정보 및 사업체의 영업·경영상 비밀을 재직 중은 물론 퇴직 후에도 외부에 누설하지 아니한다.",
  },
  {
    title: "근로조건 변경 시 사전협의",
    body: "배정 현장·근무시간 등 주요 근로조건을 변경할 필요가 있는 경우 사용자는 근로자와 사전에 협의한다.",
  },
];

type ContractStatus = "PENDING" | "SIGNED" | "COMPLETED" | "CANCELLED";

interface ContractItem {
  id: string; workerId: string; workerName: string; userPhone: string;
  contractStart: string; contractEnd: string; siteName: string | null;
  workLocation: string | null;
  workType: string | null; status: ContractStatus; signToken: string;
  workerSignedAt: string | null; adminSignedAt: string | null; createdAt: string;
}
interface SearchResult {
  id: string; workerName: string; phoneNumber: string; email: string;
  siteName: string | null; contractStart: string | null; contractEnd: string | null;
}
interface Clause { id: string; title: string; body: string; sortOrder: number; isActive: boolean; }

const STATUS_CLS: Record<ContractStatus, { label: string; cls: string }> = {
  PENDING:   { label: "서명 대기",      cls: "bg-amber-50 text-amber-600" },
  SIGNED:    { label: "직무지도원 서명", cls: "bg-sky-50 text-sky-600" },
  COMPLETED: { label: "계약 완료",      cls: "bg-emerald-50 text-emerald-600" },
  CANCELLED: { label: "취소",           cls: "bg-slate-100 text-slate-500" },
};
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatPeriod(start: string | null, end: string | null): string {
  if (!start) return "-";
  const s = start.slice(0, 7).replace("-", ".");
  const e = end ? end.slice(0, 7).replace("-", ".") : "진행중";
  return `${s} ~ ${e}`;
}

// ─────────────────────────────────────────────────────────────
// 직무지도원 이력 검색
// ─────────────────────────────────────────────────────────────
function WorkerSearchPopup({ onSelect, onClose }: { onSelect: (r: SearchResult) => void; onClose: () => void; }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setSearched(false); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/contracts/worker-search?q=${encodeURIComponent(query.trim())}`);
        const data = await res.json();
        if (data.success) setResults(data.items);
      } finally { setSearching(false); setSearched(true); }
    }, 400);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className={T.modalOverlay} style={{ zIndex: 1100 }}>
      <div className="flex w-full max-w-2xl max-h-[80vh] flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">직무지도원 검색</h3>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">이름 또는 전화번호로 검색 (과거 근로계약 이력 기준)</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
        </div>
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="이름 또는 전화번호 (2자 이상 입력)" className={`mb-4 w-full ${T.input}`} />
        <div className="flex-1 overflow-y-auto">
          {searching && <p className={T.empty}>검색 중...</p>}
          {!searching && searched && results.length === 0 && <p className={T.empty}>검색 결과가 없습니다.</p>}
          {!searching && results.length > 0 && (
            <div className={T.tableWrap}>
              <table className="w-full border-collapse">
                <thead><tr>{["이름", "전화번호", "이메일", "최근 사업체", "근무 기간"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} onClick={() => { onSelect(r); onClose(); }} className={`${T.trBase} cursor-pointer hover:bg-sky-50`}>
                      <td className={`${T.td} font-black text-slate-900`}>{r.workerName}</td>
                      <td className={`${T.td} text-slate-600`}>{r.phoneNumber}</td>
                      <td className={`${T.td} text-xs text-slate-400`}>{r.email || "-"}</td>
                      <td className={`${T.td} text-slate-600`}>{r.siteName || <span className="text-slate-300">미지정</span>}</td>
                      <td className={`${T.td} whitespace-nowrap text-xs text-slate-400`}>{formatPeriod(r.contractStart, r.contractEnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 특약 조항 관리 (CRUD)
// ─────────────────────────────────────────────────────────────
function ClauseManagerModal({ onClose }: { onClose: () => void }) {
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Clause | null>(null);
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/contract-clauses");
      const d = await r.json();
      if (d.success) setClauses(d.items);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function startEdit(c: Clause) { setEditing(c); setTitle(c.title); setBodyText(c.body); setError(""); }
  function startNew() { setEditing(null); setTitle(""); setBodyText(""); setError(""); }

  // 표준 특약 라이브러리 일괄 등록(이미 같은 제목이 있으면 건너뜀)
  const [seeding, setSeeding] = useState(false);
  async function loadStandardClauses() {
    const existing = new Set(clauses.map(c => c.title.trim()));
    const missing = STANDARD_CLAUSES.filter(c => !existing.has(c.title));
    if (missing.length === 0) { setError("표준 특약이 이미 모두 등록되어 있습니다."); return; }
    if (!confirm(`표준 특약 ${missing.length}건을 등록합니다. 계속할까요?`)) return;
    setSeeding(true); setError("");
    try {
      for (const c of missing) {
        await fetch("/api/admin/contract-clauses", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: c.title, body: c.body }),
        });
      }
      await load();
    } catch { setError("표준 특약 등록 중 일부가 실패했습니다."); }
    finally { setSeeding(false); }
  }

  async function save() {
    if (!title.trim() || !bodyText.trim()) { setError("제목과 내용을 입력하세요."); return; }
    setSaving(true); setError("");
    try {
      const url = editing ? `/api/admin/contract-clauses/${editing.id}` : "/api/admin/contract-clauses";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title.trim(), body: bodyText.trim() }) });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      startNew(); await load();
    } catch (e: any) { setError(e.message || "저장 실패"); }
    finally { setSaving(false); }
  }
  async function toggleActive(c: Clause) {
    await fetch(`/api/admin/contract-clauses/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !c.isActive }) });
    load();
  }
  async function remove(c: Clause) {
    if (!confirm(`특약 조항 "${c.title}"을(를) 삭제하시겠습니까?`)) return;
    await fetch(`/api/admin/contract-clauses/${c.id}`, { method: "DELETE" });
    if (editing?.id === c.id) startNew();
    load();
  }

  return (
    <div className={T.modalOverlay} style={{ zIndex: 1050 }} onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900">특약 조항 관리</h2>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">에이전시 전용 특약 조항을 등록·수정·삭제합니다. 계약서 생성 시 선택해 포함할 수 있어요.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadStandardClauses} disabled={seeding} className={T.btnSecondary}>{seeding ? "등록 중..." : "표준 특약 불러오기"}</button>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-5 overflow-hidden md:grid-cols-2">
          {/* 목록 */}
          <div className="overflow-y-auto pr-1">
            <h3 className="mb-2 text-xs font-black text-slate-500">등록된 조항 ({clauses.length})</h3>
            {loading ? <p className={T.empty}>로딩 중...</p> : clauses.length === 0 ? (
              <p className={T.empty}>등록된 특약 조항이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {clauses.map(c => (
                  <div key={c.id} className={`rounded-xl border p-3 ${c.isActive ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-black text-slate-900">{c.title}</p>
                      {!c.isActive && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">비활성</span>}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-slate-500">{c.body}</p>
                    <div className="mt-2 flex gap-1.5">
                      <button onClick={() => startEdit(c)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">수정</button>
                      <button onClick={() => toggleActive(c)} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">{c.isActive ? "비활성화" : "활성화"}</button>
                      <button onClick={() => remove(c)} className="rounded-lg border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50">삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* 편집 */}
          <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
            <h3 className="mb-3 text-xs font-black text-slate-500">{editing ? "조항 수정" : "새 조항 추가"}</h3>
            <div className="space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="조항 제목 (예: 비밀유지)" className={`w-full ${T.input}`} />
              <textarea value={bodyText} onChange={e => setBodyText(e.target.value)} placeholder="조항 내용" rows={6} className={`w-full resize-none py-2 ${T.input} h-auto`} />
            </div>
            {error && <p className="mt-2 text-sm font-semibold text-rose-600">{error}</p>}
            <div className="mt-3 flex gap-2">
              {editing && <button onClick={startNew} className={T.btnSecondary}>새로 작성</button>}
              <button onClick={save} disabled={saving} className={T.btnPrimary}>{saving ? "저장 중..." : editing ? "수정 저장" : "조항 추가"}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 계약서 생성 (표준양식)
// ─────────────────────────────────────────────────────────────
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className={T.label}>{label}</label>
      {children}
      {hint && <p className="text-[11px] font-semibold text-slate-400">{hint}</p>}
    </div>
  );
}

function CreateContractModal({ onClose, onCreated }: { onClose: () => void; onCreated: (url: string) => void; }) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const [contractStart, setStart] = useState("");
  const [contractEnd, setEnd] = useState("");
  const [workLocation, setWorkLocation] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  // 근무형태 + 출퇴근지도 → 소정근로/휴게 자동 셋팅(수동 수정 가능). 기본: 오전4H+출퇴근지도.
  const [workType, setWorkType] = useState<WorkType>("AM");
  const [commuteGuidanceIncluded, setCommute] = useState(true);
  const [workStartTime, setWorkStartTime] = useState("08:30");
  const [workEndTime, setWorkEndTime] = useState("14:00");
  const [breakStartTime, setBreakStartTime] = useState("13:00");
  const [breakEndTime, setBreakEndTime] = useState("13:30");

  // 프리셋 적용: 근무형태/출퇴근지도 변경 시에만 시각을 덮어씀(사용자 수동 수정은 보존).
  function applyPreset(wt: WorkType, commute: boolean) {
    if (wt === "CUSTOM") return; // 직접입력은 현재 값 유지
    const commuteEff = wt === "FULL_DAY" ? false : commute;
    const t = computeWorkTimes(wt, commuteEff);
    setWorkStartTime(t.start);
    setWorkEndTime(t.end);
    const br = BREAK_PRESETS[wt];
    setBreakStartTime(br.start);
    setBreakEndTime(br.end);
  }
  function onWorkTypeChange(wt: WorkType) {
    setWorkType(wt);
    if (wt === "FULL_DAY") setCommute(false); // 전일은 출퇴근지도 불가(8h 초과 금지)
    applyPreset(wt, wt === "FULL_DAY" ? false : commuteGuidanceIncluded);
  }
  function onCommuteChange(checked: boolean) {
    setCommute(checked);
    applyPreset(workType, checked);
  }
  const [workDaysPerWeek, setWorkDaysPerWeek] = useState("5");
  const [weeklyHoliday, setWeeklyHoliday] = useState("일");
  const [wageType, setWageType] = useState<"HOURLY" | "DAILY" | "MONTHLY">("MONTHLY");
  const [wageAmount, setWageAmount] = useState("");
  const [bonusExists, setBonusExists] = useState(false);
  const [bonusAmount, setBonusAmount] = useState("");
  const [extraPayExists, setExtraPayExists] = useState(false);
  const [extraPayDesc, setExtraPayDesc] = useState("");
  const [overtimeRate, setOvertimeRate] = useState("50");
  const [wagePayday, setWagePayday] = useState("25");
  const [wagePayMethod, setWagePayMethod] = useState<"DIRECT" | "ACCOUNT">("ACCOUNT");

  const [employerBizName, setEmployerBizName] = useState("");
  const [employerPhone, setEmployerPhone] = useState("");
  const [employerAddress, setEmployerAddress] = useState("");
  const [employerRepName, setEmployerRepName] = useState("");
  const [workerAddress, setWorkerAddress] = useState("");

  const [clauses, setClauses] = useState<Clause[]>([]);
  const [selectedClauseIds, setSelectedClauseIds] = useState<string[]>([]);
  const [adminMemo, setAdminMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // 인라인 특약 생성(작성 중 새 특약을 등록·자동선택, 영구 저장). 삭제는 특약 조항 관리에서만.
  const [showInlineClause, setShowInlineClause] = useState(false);
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineBody, setInlineBody] = useState("");
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineErr, setInlineErr] = useState("");

  async function addInlineClause() {
    if (!inlineTitle.trim() || !inlineBody.trim()) { setInlineErr("제목과 내용을 입력하세요."); return; }
    setInlineSaving(true); setInlineErr("");
    try {
      const r = await fetch("/api/admin/contract-clauses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: inlineTitle.trim(), body: inlineBody.trim() }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message);
      const created: Clause | undefined = d.item;
      if (created) {
        setClauses(prev => [...prev, created]);
        setSelectedClauseIds(prev => [...prev, created.id]); // 자동 선택
      }
      setInlineTitle(""); setInlineBody(""); setShowInlineClause(false);
    } catch (e: any) { setInlineErr(e.message || "추가 실패"); }
    finally { setInlineSaving(false); }
  }

  // 사업주 자동채움 + 특약 목록 로드
  useEffect(() => {
    fetch("/api/admin/agency-profile").then(r => r.json()).then(d => {
      if (d.success) {
        setEmployerBizName(d.data.name || "");
        setEmployerPhone(d.data.phoneNumber || "");
        setEmployerAddress(d.data.address || "");
        setEmployerRepName(d.data.representativeName || "");
      }
    }).catch(() => {});
    fetch("/api/admin/contract-clauses").then(r => r.json()).then(d => {
      if (d.success) setClauses(d.items.filter((c: Clause) => c.isActive));
    }).catch(() => {});
  }, []);

  function handleSelectWorker(r: SearchResult) { setSelectedUserId(r.id); setManualName(r.workerName); setManualPhone(r.phoneNumber); }
  function toggleClause(id: string) { setSelectedClauseIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }

  async function handleCreate() {
    if (!manualName.trim() || !manualPhone.trim()) { setError("직무지도원 이름과 전화번호는 필수입니다."); return; }
    if (!contractStart || !contractEnd) { setError("계약 시작일과 종료일은 필수입니다."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: selectedUserId || undefined,
          manualName: manualName.trim(), manualPhone: manualPhone.trim(),
          contractStart, contractEnd,
          workLocation: workLocation || null, jobDescription: jobDescription || null,
          workType, commuteGuidanceIncluded,
          customWorkStart: workType === "CUSTOM" ? workStartTime : undefined,
          customWorkEnd: workType === "CUSTOM" ? workEndTime : undefined,
          workStartTime, workEndTime, breakStartTime, breakEndTime,
          workDaysPerWeek, weeklyHoliday,
          wageType, wageAmount: wageAmount || null,
          bonusExists, bonusAmount: bonusExists ? bonusAmount : null,
          extraPayExists, extraPayDesc: extraPayExists ? extraPayDesc : null,
          overtimeRate, wagePayday, wagePayMethod,
          employerBizName, employerPhone, employerAddress, employerRepName,
          workerAddress: workerAddress || null,
          clauseIds: selectedClauseIds,
          adminMemo: adminMemo || null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      alert(data.message);
      onCreated(data.contractUrl);
      onClose();
    } catch (e: any) { setError(e.message || "생성에 실패했습니다."); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className={T.modalOverlay} onClick={() => !saving && onClose()}>
        <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-black text-slate-900">근로계약서 생성 (표준양식)</h2>
            <button onClick={() => !saving && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* 직무지도원 */}
            <section className="space-y-2">
              <h3 className="text-xs font-black text-slate-500">근로자(직무지도원)</h3>
              <div className="flex gap-2">
                <input value={manualName} onChange={e => { setManualName(e.target.value); setSelectedUserId(""); }} placeholder="이름 *" className={`flex-1 ${T.input}`} />
                <button type="button" onClick={() => setShowSearch(true)} className="whitespace-nowrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 transition hover:bg-sky-100">이력 검색</button>
              </div>
              <input value={manualPhone} onChange={e => { setManualPhone(e.target.value); setSelectedUserId(""); }} placeholder="전화번호 (예: 010-1234-5678) *" className={`w-full ${T.input}`} />
              <input value={workerAddress} onChange={e => setWorkerAddress(e.target.value)} placeholder="근로자 주소 (미입력 시 서명 단계에서 직접 입력)" className={`w-full ${T.input}`} />
              {selectedUserId && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">✓ 과거 이력에서 선택됨 — {manualName}</p>}
            </section>

            {/* 1. 계약기간 */}
            <section className="grid grid-cols-2 gap-2">
              <Field label="1. 계약 시작일 *" hint="키패드로 직접 입력 가능 (예: 2026-06-15)"><input type="date" value={contractStart} onChange={e => setStart(e.target.value)} className={`w-full ${T.input}`} /></Field>
              <Field label="계약 종료일 *" hint="키패드로 직접 입력 가능"><input type="date" value={contractEnd} onChange={e => setEnd(e.target.value)} className={`w-full ${T.input}`} /></Field>
            </section>

            {/* 2~3 */}
            <Field label="2. 근무 장소"><input value={workLocation} onChange={e => setWorkLocation(e.target.value)} placeholder="근무 장소" className={`w-full ${T.input}`} /></Field>
            <Field label="3. 업무의 내용"><textarea value={jobDescription} onChange={e => setJobDescription(e.target.value)} placeholder="예: 중증장애인 직무지도 및 적응지원" rows={2} className={`w-full resize-none py-2 ${T.input} h-auto`} /></Field>

            {/* 4. 소정근로시간 */}
            <section className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
              <label className={T.label}>4. 소정근로시간 / 휴게시간</label>
              {/* 근무형태 라디오 */}
              <div className="flex gap-2">
                {WORK_TYPE_OPTIONS.map(o => (
                  <button key={o.value} type="button" onClick={() => onWorkTypeChange(o.value)} className={`flex-1 rounded-xl border px-2 py-2 text-sm font-semibold transition ${workType === o.value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{o.label}</button>
                ))}
              </div>
              {/* 출퇴근지도 체크박스 */}
              <label className={`flex items-center gap-2 text-sm font-semibold ${workType === "FULL_DAY" ? "text-slate-300" : "text-slate-600"}`}>
                <input type="checkbox" checked={commuteGuidanceIncluded} disabled={workType === "FULL_DAY"} onChange={e => onCommuteChange(e.target.checked)} className="h-4 w-4 accent-slate-950 disabled:opacity-40" />
                출퇴근지도 포함 (출근 −30분 / 퇴근 +30분 자동)
                {workType === "FULL_DAY" && <span className="text-[11px] font-medium text-slate-400">· 전일은 불가</span>}
              </label>
              {/* 시각(자동 셋팅, 수동 수정 가능) */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1"><span className="w-7 text-xs text-slate-400">근로</span><input type="time" value={workStartTime} onChange={e => setWorkStartTime(e.target.value)} className={`w-full ${T.input}`} /><span className="text-xs text-slate-400">~</span><input type="time" value={workEndTime} onChange={e => setWorkEndTime(e.target.value)} className={`w-full ${T.input}`} /></div>
                <div className="flex items-center gap-1"><span className="w-7 text-xs text-slate-400">휴게</span><input type="time" value={breakStartTime} onChange={e => setBreakStartTime(e.target.value)} className={`w-full ${T.input}`} /><span className="text-xs text-slate-400">~</span><input type="time" value={breakEndTime} onChange={e => setBreakEndTime(e.target.value)} className={`w-full ${T.input}`} /></div>
              </div>
              <p className="text-[11px] font-semibold text-slate-400">근무형태·출퇴근지도 선택 시 시각이 자동 입력됩니다. 필요하면 직접 수정하세요.</p>
            </section>

            {/* 5. 근무일/휴일 */}
            <section className="grid grid-cols-2 gap-2">
              <Field label="5. 주 근무일수"><div className="flex items-center gap-2"><input type="number" min={1} max={7} value={workDaysPerWeek} onChange={e => setWorkDaysPerWeek(e.target.value)} className={`w-full ${T.input}`} /><span className="text-sm text-slate-400">일</span></div></Field>
              <Field label="주휴일"><select value={weeklyHoliday} onChange={e => setWeeklyHoliday(e.target.value)} className={`w-full ${T.input}`}>{WEEKDAYS.map(d => <option key={d} value={d}>{d}요일</option>)}</select></Field>
            </section>

            {/* 6. 임금 */}
            <section className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
              <label className={T.label}>6. 임금</label>
              <div className="flex gap-2">
                {([["HOURLY", "시급"], ["DAILY", "일급"], ["MONTHLY", "월급"]] as const).map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setWageType(v)} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition ${wageType === v ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{l}</button>
                ))}
              </div>
              <div className="flex items-center gap-2"><input type="number" value={wageAmount} onChange={e => setWageAmount(e.target.value)} placeholder="임금액" className={`w-full ${T.input}`} /><span className="text-sm text-slate-400">원</span></div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={bonusExists} onChange={e => setBonusExists(e.target.checked)} className="h-4 w-4 accent-slate-950" />상여금 있음</label>
                {bonusExists && <div className="flex items-center gap-1"><input type="number" value={bonusAmount} onChange={e => setBonusAmount(e.target.value)} placeholder="상여금액" className={`w-full ${T.input}`} /><span className="text-xs text-slate-400">원</span></div>}
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked={extraPayExists} onChange={e => setExtraPayExists(e.target.checked)} className="h-4 w-4 accent-slate-950" />기타급여(제수당 등) 있음</label>
                {extraPayExists && <input value={extraPayDesc} onChange={e => setExtraPayDesc(e.target.value)} placeholder="내역 기재" className={`w-full ${T.input}`} />}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="가산임금률(%)" hint="5인 이상 50%(1.5배) 법정 기준. 5인 미만은 0% 가능"><input type="number" value={overtimeRate} onChange={e => setOvertimeRate(e.target.value)} className={`w-full ${T.input}`} /></Field>
                <Field label="임금지급일"><input value={wagePayday} onChange={e => setWagePayday(e.target.value)} placeholder="매월 N일" className={`w-full ${T.input}`} /></Field>
                <Field label="지급방법"><select value={wagePayMethod} onChange={e => setWagePayMethod(e.target.value as any)} className={`w-full ${T.input}`}><option value="ACCOUNT">계좌입금</option><option value="DIRECT">직접지급</option></select></Field>
              </div>
            </section>

            {/* 사업주 */}
            <section className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
              <label className={T.label}>사업주(갑) — 에이전시 정보 자동 입력 (수정 가능)</label>
              {(!employerRepName || !employerPhone || !employerAddress) && (
                <p className="text-[11px] font-semibold text-amber-600">대표자·전화·주소가 비어 있으면 <a href="/manager/settings" target="_blank" className="underline">사업주 정보 설정</a>에서 미리 등록하면 매번 자동 입력됩니다.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={employerBizName} onChange={e => setEmployerBizName(e.target.value)} placeholder="사업체명" className={`w-full ${T.input}`} />
                <input value={employerPhone} onChange={e => setEmployerPhone(e.target.value)} placeholder="전화" className={`w-full ${T.input}`} />
              </div>
              <input value={employerAddress} onChange={e => setEmployerAddress(e.target.value)} placeholder="주소" className={`w-full ${T.input}`} />
              <input value={employerRepName} onChange={e => setEmployerRepName(e.target.value)} placeholder="대표자명" className={`w-full ${T.input}`} />
            </section>

            {/* 특약 조항 */}
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <label className={T.label}>특약 조항 (선택)</label>
                <button type="button" onClick={() => { setShowInlineClause(v => !v); setInlineErr(""); }} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">
                  {showInlineClause ? "닫기" : "+ 새 특약 추가"}
                </button>
              </div>

              {/* 인라인 생성: 작성 중 새 특약을 등록하면 영구 저장되고 자동 선택됩니다. 삭제는 '특약 조항 관리'에서만. */}
              {showInlineClause && (
                <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/40 p-3">
                  <input value={inlineTitle} onChange={e => setInlineTitle(e.target.value)} placeholder="조항 제목 (예: 비밀유지)" className={`w-full ${T.input}`} />
                  <textarea value={inlineBody} onChange={e => setInlineBody(e.target.value)} placeholder="조항 내용" rows={3} className={`w-full resize-none py-2 ${T.input} h-auto`} />
                  {inlineErr && <p className="text-xs font-semibold text-rose-600">{inlineErr}</p>}
                  <div className="flex justify-end">
                    <button type="button" onClick={addInlineClause} disabled={inlineSaving} className={T.btnPrimary}>{inlineSaving ? "추가 중..." : "추가하고 선택"}</button>
                  </div>
                  <p className="text-[11px] font-medium text-slate-400">추가한 특약은 목록에 영구 저장되어 다음 계약서에도 재사용됩니다. (삭제는 상단 &quot;특약 조항 관리&quot;)</p>
                </div>
              )}

              {clauses.length === 0 ? (
                <p className="text-xs font-semibold text-slate-400">등록된 특약 조항이 없습니다. &quot;+ 새 특약 추가&quot; 또는 상단 &quot;특약 조항 관리&quot;에서 추가하세요.</p>
              ) : clauses.map(c => (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 p-2.5 hover:bg-slate-50">
                  <input type="checkbox" checked={selectedClauseIds.includes(c.id)} onChange={() => toggleClause(c.id)} className="mt-0.5 h-4 w-4 accent-slate-950" />
                  <div><p className="text-sm font-black text-slate-800">{c.title}</p><p className="line-clamp-2 text-xs text-slate-500">{c.body}</p></div>
                </label>
              ))}
            </section>

            <Field label="관리자 메모 (내부용, 계약서 미표시)"><textarea value={adminMemo} onChange={e => setAdminMemo(e.target.value)} rows={2} className={`w-full resize-none py-2 ${T.input} h-auto`} /></Field>
          </div>

          {error && <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => !saving && onClose()} disabled={saving} className={T.btnSecondary}>취소</button>
            <button onClick={handleCreate} disabled={saving} className={T.btnPrimary}>{saving ? "생성 중..." : "계약서 생성 및 발송"}</button>
          </div>
        </div>
      </div>
      {showSearch && <WorkerSearchPopup onSelect={handleSelectWorker} onClose={() => setShowSearch(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 계약서 상세 조회
// ─────────────────────────────────────────────────────────────
function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`/api/admin/contracts/${id}`).then(r => r.json()).then(d => { if (d.success) setData(d.data); }).finally(() => setLoading(false));
  }, [id]);

  const pdfUrl = `/api/admin/contracts/${id}?format=pdf`;
  const wt: Record<string, string> = { HOURLY: "시급", DAILY: "일급", MONTHLY: "월급" };

  return (
    <div className={T.modalOverlay} onClick={onClose} style={{ zIndex: 1050 }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">근로계약서 상세</h2>
          <div className="flex items-center gap-2">
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={T.btnPrimary}>PDF 보기 / 다운로드</a>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {loading ? <p className={T.empty}>로딩 중...</p> : !data ? <p className={T.empty}>불러올 수 없습니다.</p> : (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <iframe src={pdfUrl} className="h-[55vh] w-full rounded-xl border border-slate-200" title="계약서 미리보기" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {[
                ["근로자", data.workerName], ["연락처", data.workerPhone],
                ["계약기간", `${data.contractStart} ~ ${data.contractEnd}`],
                ["근무장소", data.workLocation || "-"], ["업무내용", data.jobDescription || "-"],
                ["소정근로", `${data.workStartTime || "-"} ~ ${data.workEndTime || "-"}`],
                ["임금", data.wageAmount ? `${wt[data.wageType] || ""} ${Number(data.wageAmount).toLocaleString()}원` : "-"],
                ["사업주", data.employerBizName || "-"], ["대표자", data.employerRepName || "-"],
                ["상태", STATUS_CLS[data.status as ContractStatus]?.label || data.status],
              ].map(([k, v]) => (
                <div key={k as string} className="flex gap-2 border-b border-slate-50 py-1"><span className="w-20 flex-shrink-0 font-semibold text-slate-400">{k}</span><span className="font-semibold text-slate-700">{v}</span></div>
              ))}
            </div>
            {Array.isArray(data.specialClauses) && data.specialClauses.length > 0 && (
              <div><p className="mb-1 text-xs font-black text-slate-500">특약사항</p>{data.specialClauses.map((c: any, i: number) => <div key={i} className="border-b border-slate-50 py-1.5"><p className="text-sm font-bold text-slate-700">{i + 1}) {c.title}</p><p className="text-xs text-slate-500">{c.body}</p></div>)}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────────────────────
export default function AdminContractsPage() {
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showClauses, setShowClauses] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  function loadContracts() {
    fetch("/api/admin/contracts").then(r => r.json()).then(c => { if (c.success) setContracts(c.items); }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { loadContracts(); }, []);

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${baseUrl}/contract/${token}`).then(() => alert("링크가 복사되었습니다."));
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="근로계약서 관리"
        sub="고용노동부 표준양식 기반 전자계약서 생성·발송·조회"
        actions={
          <div className="flex gap-2">
            <button onClick={() => setShowClauses(true)} className={T.btnSecondary}>특약 조항 관리</button>
            <button onClick={() => setShowCreate(true)} className={T.btnPrimary}>+ 계약서 생성</button>
          </div>
        }
      />

      {lastCreatedUrl && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex-1"><p className="text-sm font-black text-emerald-700">계약서가 생성되었습니다</p><p className="mt-0.5 break-all text-xs font-semibold text-slate-600">{lastCreatedUrl}</p></div>
          <button onClick={() => { navigator.clipboard.writeText(lastCreatedUrl); alert("복사되었습니다."); }} className="whitespace-nowrap rounded-xl border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50">링크 복사</button>
        </div>
      )}

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["직무지도원", "계약 기간", "근무장소", "상태", "서명일", "관리"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            : contracts.length === 0 ? <tr><td colSpan={6} className={T.tdCenter}>계약서가 없습니다.</td></tr>
            : contracts.map(c => {
              const st = STATUS_CLS[c.status] ?? { label: c.status, cls: "bg-slate-100 text-slate-500" };
              return (
                <tr key={c.id} className={T.trBase}>
                  <td className={T.td}><div className="font-black text-slate-900">{c.workerName}</div><div className="text-xs text-slate-400">{c.userPhone}</div></td>
                  <td className={`${T.td} text-xs text-slate-500`}>{c.contractStart?.slice(0, 10)}<br />~ {c.contractEnd?.slice(0, 10)}</td>
                  <td className={`${T.td} text-slate-600`}>{c.workLocation || c.siteName || <span className="text-slate-300">미지정</span>}</td>
                  <td className={T.td}><span className={`${T.badge} ${st.cls}`}>{st.label}</span></td>
                  <td className={`${T.td} text-xs text-slate-400`}>{c.workerSignedAt ? c.workerSignedAt.slice(0, 10) : "-"}</td>
                  <td className={T.td}>
                    <div className="flex gap-1.5">
                      <button onClick={() => setDetailId(c.id)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50">상세</button>
                      {c.status === "PENDING" && <button onClick={() => copyLink(c.signToken)} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">링크</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showCreate && <CreateContractModal onClose={() => setShowCreate(false)} onCreated={(url) => { setLastCreatedUrl(url); loadContracts(); }} />}
      {showClauses && <ClauseManagerModal onClose={() => setShowClauses(false)} />}
      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
