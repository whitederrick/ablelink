"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { getTemplate, DEFAULT_TEMPLATE_KEY, visibleTemplates, canUseTemplate, templateWageTypes, canUseTemplateForWage } from "@/lib/contractTemplates";
import { StatCardRow } from "../_components/StatCard";
import { X } from "lucide-react";
import { computeWorkTimes, type WorkType } from "@/lib/workSchedule";
import { workerLabel } from "../_format";

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
  id: string; workerId: string; workerName: string; loginId: string; userPhone: string;
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

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING:   { label: "서명 대기",      tone: "amber" },
  SIGNED:    { label: "직무지도원 서명", tone: "sky" },
  COMPLETED: { label: "계약 완료",      tone: "emerald" },
  CANCELLED: { label: "취소",           tone: "slate" },
};
const PAGE_SIZE = 10;
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
                <thead><tr>{["이름", "전화번호", "이메일", "최근 현장(사업체)", "근무 기간"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {results.map(r => (
                    <tr key={r.id} onClick={() => { onSelect(r); onClose(); }} className={`${T.trBase} cursor-pointer hover:bg-sky-50`}>
                      <td className={`${T.td} font-black text-slate-900`}><div className="max-w-[100px] truncate">{r.workerName}</div></td>
                      <td className={`${T.td} text-slate-600`}>{r.phoneNumber}</td>
                      <td className={`${T.td} text-xs text-slate-400`}><div className="max-w-[140px] truncate">{r.email || "-"}</div></td>
                      <td className={`${T.td} text-slate-600`}><div className="max-w-[120px] truncate">{r.siteName || <span className="text-slate-300">미지정</span>}</div></td>
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
            <p className="mt-0.5 text-xs font-semibold text-slate-400">위탁기관 전용 특약 조항을 등록·수정·삭제합니다. 계약서 생성 시 선택해 포함할 수 있어요.</p>
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
// 계약서 양식 미리보기 (견본 데이터로 선택 양식 PDF 렌더)
// ─────────────────────────────────────────────────────────────
function TemplatePreviewModal({ templateKey, templateData, onClose }: { templateKey: string; templateData: Record<string, any>; onClose: () => void; }) {
  const tpl = getTemplate(templateKey);
  const url = `/api/admin/contracts/preview?templateKey=${encodeURIComponent(templateKey)}&data=${encodeURIComponent(JSON.stringify(templateData || {}))}`;
  return (
    <div className={T.modalOverlay} style={{ zIndex: 1200 }} onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">양식 미리보기 — {tpl.label}</h3>
            <p className="mt-0.5 text-xs font-semibold text-slate-400">견본(샘플) 데이터로 양식 레이아웃을 보여줍니다. 실제 계약은 저장되지 않습니다.</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={url} target="_blank" rel="noopener noreferrer" className={T.btnSecondary}>새 창</a>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <iframe src={url} className="h-[72vh] w-full rounded-xl border border-slate-200" title="양식 미리보기" />
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

type ContractPrefill = {
  assignmentId?: string; workerId?: string; workerName?: string; phone?: string;
  siteName?: string; contractStart?: string; contractEnd?: string;
  workType?: WorkType; commuteGuidanceIncluded?: boolean;
  customWorkStart?: string | null; customWorkEnd?: string | null;
};

function CreateContractModal({ onClose, onCreated, prefill }: { onClose: () => void; onCreated: (url: string) => void; prefill?: ContractPrefill; }) {
  // 배정에서 진입 시(prefill) 근무형태 기준으로 소정근로/휴게 초기값 산정
  const initWt = (prefill?.workType as WorkType) ?? "AM";
  const initCommute = initWt === "FULL_DAY" ? false : (prefill?.commuteGuidanceIncluded ?? true);
  const initTimes = computeWorkTimes(initWt, initCommute, prefill?.customWorkStart, prefill?.customWorkEnd);
  const initBreak = initWt === "CUSTOM" ? { start: "13:00", end: "13:30" } : BREAK_PRESETS[initWt];

  // 계약서 양식 선택 + 양식별 추가 입력값
  const [templateKey, setTemplateKey] = useState<string>(DEFAULT_TEMPLATE_KEY);
  const [templateData, setTemplateData] = useState<Record<string, any>>({});
  const [showPreview, setShowPreview] = useState(false);
  // 본 기관에 노출 가능한 양식 = 공용 + 운영자가 부여한 전용 양식
  const [allowedTemplates, setAllowedTemplates] = useState<string[]>([]);

  const [selectedUserId, setSelectedUserId] = useState(prefill?.workerId ?? "");
  const [manualName, setManualName] = useState(prefill?.workerName ?? "");
  const [manualPhone, setManualPhone] = useState(prefill?.phone ?? "");
  const [showSearch, setShowSearch] = useState(false);

  const [contractStart, setStart] = useState(prefill?.contractStart ?? "");
  const [contractEnd, setEnd] = useState(prefill?.contractEnd ?? "");
  const [workLocation, setWorkLocation] = useState(prefill?.siteName ?? "");
  const [jobDescription, setJobDescription] = useState("");
  // 근무형태 + 출퇴근지도 → 소정근로/휴게 자동 셋팅(수동 수정 가능). 기본: 오전4H+출퇴근지도.
  const [workType, setWorkType] = useState<WorkType>(initWt);
  const [commuteGuidanceIncluded, setCommute] = useState(initCommute);
  const [workStartTime, setWorkStartTime] = useState(initTimes.start);
  const [workEndTime, setWorkEndTime] = useState(initTimes.end);
  const [breakStartTime, setBreakStartTime] = useState(initBreak.start);
  const [breakEndTime, setBreakEndTime] = useState(initBreak.end);

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
  // 노출 양식 = (공용+부여) 중 현재 임금유형으로 쓸 수 있는 것만. 기관 전용 시급제 양식은 시급 선택 시에만 노출.
  const templateOptions = useMemo(
    () => visibleTemplates(allowedTemplates).filter(t => canUseTemplateForWage(t.key, wageType)),
    [allowedTemplates, wageType]
  );
  // 임금유형 변경 시: 현재 양식이 그 유형을 지원하지 않으면 표준으로 되돌림
  const onWageTypeChange = (v: "HOURLY" | "DAILY" | "MONTHLY") => {
    setWageType(v);
    if (!canUseTemplateForWage(templateKey, v)) { setTemplateKey(DEFAULT_TEMPLATE_KEY); setTemplateData({}); }
  };
  // 양식 변경 시: 현재 임금유형을 지원하지 않으면 그 양식이 허용하는 첫 유형으로 맞춤
  const onTemplateChange = (key: string) => {
    setTemplateKey(key); setTemplateData({});
    const wts = templateWageTypes(key);
    if (!wts.includes(wageType)) setWageType(wts[0]);
  };
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
  // 대표 서명: 설정에 등록된 서명을 '적용' 액션으로 명시적으로 넣어야 계약서에 들어간다(자동주입 안 함).
  const [repSignatureUrl, setRepSignatureUrl] = useState<string | null>(null);
  const [applyRepSignature, setApplyRepSignature] = useState(false);

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
        setRepSignatureUrl(d.data.representativeSignatureUrl || null);
        // 직인/대표 서명이 등록돼 있으면 기본 적용(ON). 매니저가 원하면 체크 해제 가능.
        setApplyRepSignature(!!d.data.representativeSignatureUrl);
        const allowed: string[] = Array.isArray(d.data.allowedContractTemplates) ? d.data.allowedContractTemplates : [];
        setAllowedTemplates(allowed);
        // 기관 기본 양식 프리필(없거나 사용 불가면 표준 유지). 양식이 현재 임금유형을 지원 안 하면 그 양식의 첫 유형으로 맞춤.
        if (d.data.defaultContractTemplate && canUseTemplate(d.data.defaultContractTemplate, allowed)) {
          const key = d.data.defaultContractTemplate;
          setTemplateKey(key); setTemplateData({});
          setWageType(prev => templateWageTypes(key).includes(prev) ? prev : templateWageTypes(key)[0]);
        }
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
    if (!wageAmount || Number(wageAmount) <= 0) { setError("임금액(시급/일급/월급)은 필수입니다. 급여 자동 계산에 사용됩니다."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/admin/contracts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerId: selectedUserId || undefined,
          assignmentId: prefill?.assignmentId || undefined, // 배정 진입 시 계약↔배정 연결(서명 시 write-back)
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
          applyRepSignature: applyRepSignature && !!repSignatureUrl,
          workerAddress: workerAddress || null,
          clauseIds: selectedClauseIds,
          adminMemo: adminMemo || null,
          templateKey, templateData,
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
            <h2 className="text-base font-black text-slate-900">근로계약서 생성</h2>
            <button onClick={() => !saving && onClose()} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* 계약서 양식 선택 — 표준 외 기관 양식. 양식별 추가 입력만 동적 노출 */}
            <section className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between">
                <label className={T.label}>계약서 양식</label>
                <button type="button" onClick={() => setShowPreview(true)} className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">미리보기</button>
              </div>
              <select value={templateKey} onChange={e => onTemplateChange(e.target.value)} className={`w-full ${T.input}`}>
                {templateOptions.map(t => <option key={t.key} value={t.key}>{t.label}{t.sub ? ` — ${t.sub}` : ""}</option>)}
              </select>
              <p className="text-[11px] font-semibold text-slate-400">
                기관 전용 계약서 양식이 필요하면 <a href="/manager/support" target="_blank" className="font-bold text-sky-600 underline">운영자에게 양식 등록 요청</a>하세요. 운영자가 양식을 제작·부여하면 여기 목록에 표시됩니다.
              </p>
              {getTemplate(templateKey).extraFields.length > 0 && (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] font-semibold text-slate-400">이 양식에 필요한 추가 입력</p>
                  {getTemplate(templateKey).extraFields.map(f => (
                    f.type === "checkbox" ? (
                      <label key={f.key} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <input type="checkbox" checked={!!templateData[f.key]} onChange={e => setTemplateData(d => ({ ...d, [f.key]: e.target.checked }))} className="h-4 w-4 accent-slate-950" />
                        {f.label}{f.hint && <span className="text-[11px] font-medium text-slate-400">· {f.hint}</span>}
                      </label>
                    ) : (
                      <Field key={f.key} label={f.label} hint={f.hint}>
                        <input type={f.type === "date" ? "date" : "text"} value={templateData[f.key] ?? ""} onChange={e => setTemplateData(d => ({ ...d, [f.key]: e.target.value }))} className={`w-full ${T.input}`} />
                      </Field>
                    )
                  ))}
                </div>
              )}
            </section>

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
              <label className={T.label}>6. 임금 <span className="text-rose-500">*</span></label>
              <div className="flex gap-2">
                {([["HOURLY", "시급"], ["DAILY", "일급"], ["MONTHLY", "월급"]] as const).map(([v, l]) => {
                  const ok = canUseTemplateForWage(templateKey, v);
                  return (
                    <button key={v} type="button" disabled={!ok} onClick={() => onWageTypeChange(v)} title={ok ? "" : `현재 양식(${getTemplate(templateKey).label})은 이 임금유형을 지원하지 않습니다`} className={`flex-1 rounded-xl border px-3 py-2 text-sm font-semibold transition ${wageType === v ? "border-slate-950 bg-slate-950 text-white" : !ok ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{l}</button>
                  );
                })}
              </div>
              {templateWageTypes(templateKey).length < 3 && (
                <p className="text-[11px] font-semibold text-slate-400">현재 양식은 <span className="text-slate-600">{templateWageTypes(templateKey).map(w => ({ HOURLY: "시급", DAILY: "일급", MONTHLY: "월급" }[w])).join("·")}</span>만 지원합니다. 다른 임금유형은 표준 근로계약서를 사용하세요.</p>
              )}
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

            {/* 사업주 — 본 기관 정보 자동 입력(수정 잠금). 변경은 설정 한 곳에서만. */}
            <section className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-3">
              <label className={T.label}>사업주(갑) — 본 기관 정보 자동 입력 · 수정 불가</label>
              {(!employerBizName || !employerRepName || !employerPhone || !employerAddress) && (
                <p className="text-[11px] font-semibold text-amber-600">비어 있는 항목은 <a href="/manager/settings" target="_blank" className="underline">사업주 정보 설정</a>에서 등록하세요. 계약서에 자동 반영됩니다.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={employerBizName} readOnly tabIndex={-1} placeholder="사업체명" className={`w-full ${T.input} cursor-not-allowed bg-slate-100 text-slate-500`} />
                <input value={employerPhone} readOnly tabIndex={-1} placeholder="전화" className={`w-full ${T.input} cursor-not-allowed bg-slate-100 text-slate-500`} />
              </div>
              <input value={employerAddress} readOnly tabIndex={-1} placeholder="주소" className={`w-full ${T.input} cursor-not-allowed bg-slate-100 text-slate-500`} />
              <input value={employerRepName} readOnly tabIndex={-1} placeholder="대표자명" className={`w-full ${T.input} cursor-not-allowed bg-slate-100 text-slate-500`} />
              <p className="text-[11px] font-medium text-slate-400">사업체명·대표자·주소·전화는 <a href="/manager/settings" target="_blank" className="underline">사업주 정보 설정</a>에서만 변경됩니다(계약마다 수정 불가).</p>

              {/* 대표 서명 적용 (명시적 액션) */}
              <div className="mt-1 rounded-xl border border-slate-200 bg-white p-2.5">
                {repSignatureUrl ? (
                  <label className="flex items-center gap-2.5">
                    <input type="checkbox" checked={applyRepSignature} onChange={e => setApplyRepSignature(e.target.checked)} className="h-4 w-4" />
                    <span className="flex items-center gap-2 text-[13px] font-bold text-slate-700">
                      대표 서명 적용
                      <img src={repSignatureUrl} alt="대표 서명" className="h-7 rounded border border-slate-100 bg-slate-50 object-contain px-1" />
                    </span>
                  </label>
                ) : (
                  <p className="text-[11px] font-semibold text-amber-600">
                    등록된 대표 서명이 없습니다. <a href="/manager/settings" target="_blank" className="underline">사업주 정보 설정</a>에서 대표 서명을 먼저 등록하세요. (미등록 시 계약서 대표 서명칸은 비어 발송됩니다)
                  </p>
                )}
                {repSignatureUrl && !applyRepSignature && (
                  <p className="mt-1 pl-6 text-[11px] font-medium text-slate-400">체크하지 않으면 대표 서명 없이 발송됩니다.</p>
                )}
              </div>
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
      {showPreview && <TemplatePreviewModal templateKey={templateKey} templateData={templateData} onClose={() => setShowPreview(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// 계약서 상세 조회
// ─────────────────────────────────────────────────────────────
function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rev, setRev] = useState(0); // PDF iframe 캐시 버스팅
  const [applying, setApplying] = useState(false);
  function load() {
    return fetch(`/api/admin/contracts/${id}`).then(r => r.json()).then(d => { if (d.success) setData(d.data); }).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [id]);

  async function applyRepSignature() {
    if (!confirm("이 계약서에 사업주 대표자명·직인을 적용할까요?\n기관에 등록된 대표 서명/직인이 들어갑니다.")) return;
    setApplying(true);
    try {
      const res = await fetch(`/api/admin/contracts/${id}/apply-rep-signature`, { method: "POST" });
      const d = await res.json();
      alert(d.message || (d.success ? "적용되었습니다." : "실패"));
      if (d.success) { await load(); setRev(v => v + 1); }
    } catch { alert("처리 중 오류가 발생했습니다."); }
    finally { setApplying(false); }
  }

  const pdfUrl = `/api/admin/contracts/${id}?format=pdf`;
  const wt: Record<string, string> = { HOURLY: "시급", DAILY: "일급", MONTHLY: "월급" };

  return (
    <div className={T.modalOverlay} onClick={onClose} style={{ zIndex: 1050 }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-slate-900">근로계약서 상세</h2>
          <div className="flex items-center gap-2">
            {data && !data.adminSignatureUrl && (
              <button onClick={applyRepSignature} disabled={applying} className={`${T.btnSecondary} disabled:opacity-40`}>
                {applying ? "적용 중..." : "사업주 직인 적용"}
              </button>
            )}
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer" className={T.btnPrimary}>PDF 보기 / 다운로드</a>
            <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50"><X className="h-4 w-4" /></button>
          </div>
        </div>
        {loading ? <p className={T.empty}>로딩 중...</p> : !data ? <p className={T.empty}>불러올 수 없습니다.</p> : (
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            <iframe src={`${pdfUrl}&t=${rev}`} className="h-[55vh] w-full rounded-xl border border-slate-200" title="계약서 미리보기" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {[
                ["근로자", data.workerName], ["연락처", data.workerPhone],
                ["계약기간", `${data.contractStart} ~ ${data.contractEnd}`],
                ["근무장소", data.workLocation || "-"], ["업무내용", data.jobDescription || "-"],
                ["소정근로", `${data.workStartTime || "-"} ~ ${data.workEndTime || "-"}`],
                ["임금", data.wageAmount ? `${wt[data.wageType] || ""} ${Number(data.wageAmount).toLocaleString()}원` : "-"],
                ["사업주", data.employerBizName || "-"], ["대표자", data.employerRepName || "-"],
                ["상태", STATUS_BADGE[data.status as ContractStatus]?.label || data.status],
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  const [prefill, setPrefill] = useState<ContractPrefill | undefined>(undefined);

  function loadContracts() {
    fetch("/api/admin/contracts").then(r => r.json()).then(c => { if (c.success) setContracts(c.items); }).catch(() => {}).finally(() => setLoading(false));
  }
  useEffect(() => { loadContracts(); }, []);

  // 배정에서 진입(?assignmentId=&workerId=): 배정 정보로 프리필 + 계약서 생성 모달 자동 오픈
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const aid = sp.get("assignmentId");
    const wid = sp.get("workerId");
    if (!aid || !wid) return;
    (async () => {
      try {
        const res = await fetch(`/api/admin/assignments?workerId=${wid}`);
        const data = await res.json();
        if (!data.success) return;
        const item = (data.items ?? []).find((i: any) => String(i.id) === String(aid));
        if (!item) return;
        setPrefill({
          assignmentId: String(item.id),
          workerId: String(item.user?.id ?? wid),
          workerName: item.user?.workerName ?? "",
          phone: item.user?.phoneNumber ?? "",
          siteName: item.site?.companyName ?? "",
          contractStart: item.startDate ? String(item.startDate).slice(0, 10) : "",
          contractEnd: item.endDate ? String(item.endDate).slice(0, 10) : "",
          workType: (item.workType as WorkType) ?? undefined,
          commuteGuidanceIncluded: item.commuteGuidanceIncluded,
          customWorkStart: item.customWorkStart ?? null,
          customWorkEnd: item.customWorkEnd ?? null,
        });
        setShowCreate(true);
      } catch {}
    })();
  }, []);

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${baseUrl}/contract/${token}`).then(() => alert("링크가 복사되었습니다."));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contracts
      .filter(c => statusFilter.length === 0 || statusFilter.includes(c.status))
      .filter(c => !q || c.workerName.toLowerCase().includes(q) || (c.userPhone ?? "").includes(q) || (c.workLocation ?? c.siteName ?? "").toLowerCase().includes(q));
  }, [contracts, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const cnt = (s: string) => contracts.filter(c => c.status === s).length;
  const filters: FilterChip[] = [
    { value: "PENDING", label: "서명 대기", count: cnt("PENDING") },
    { value: "SIGNED", label: "직무지도원 서명", count: cnt("SIGNED") },
    { value: "COMPLETED", label: "계약 완료", count: cnt("COMPLETED") },
    { value: "CANCELLED", label: "취소", count: cnt("CANCELLED") },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="근로계약서 관리 (Pro+)"
        sub="고용노동부 표준양식으로 직무지도원의 전자 근로계약서를 작성하고, 직무지도원에게 발송하거나 작성된 계약서를 조회합니다."
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

      <StatCardRow
        cols={4}
        items={[
          { label: "전체", value: contracts.length },
          { label: "서명 대기", value: cnt("PENDING"), tone: "amber" },
          { label: "직무지도원 서명", value: cnt("SIGNED"), tone: "sky" },
          { label: "계약 완료", value: cnt("COMPLETED"), tone: "emerald" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="직무지도원·연락처·근무장소 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead><tr>{["직무지도원 성명(아이디)", "전화번호", "계약 기간", "근무장소", "서명일", "진행 상태"].map(h => <th key={h} className={T.th}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className={T.tdCenter}>로딩 중...</td></tr>
            : filtered.length === 0 ? <tr><td colSpan={6} className={T.tdCenter}>{contracts.length === 0 ? "계약서가 없습니다." : "조건에 맞는 계약서가 없습니다."}</td></tr>
            : pageItems.map(c => {
              return (
                <tr key={c.id} className={`${T.trBase} cursor-pointer hover:bg-slate-50`} onClick={() => setDetailId(c.id)}>
                  <td className={`${T.td} whitespace-nowrap`}>{workerLabel(c.workerName, c.loginId)}</td>
                  <td className={T.td}>{c.userPhone || "-"}</td>
                  <td className={`${T.td} whitespace-nowrap`}>{c.contractStart?.slice(0, 10)} ~ {c.contractEnd?.slice(0, 10)}</td>
                  <td className={T.td}><div className="max-w-[200px] truncate">{c.workLocation || c.siteName || <span className="text-slate-400">미지정</span>}</div></td>
                  <td className={`${T.td} whitespace-nowrap`}>{c.workerSignedAt ? c.workerSignedAt.slice(0, 10) : "-"}</td>
                  <td className={T.td}>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={c.status} map={STATUS_BADGE} />
                      {c.status === "PENDING" && <button onClick={e => { e.stopPropagation(); copyLink(c.signToken); }} className="inline-flex h-7 items-center rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-[13px] font-bold text-sky-700 hover:bg-sky-100">서명 링크</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>

      {showCreate && <CreateContractModal prefill={prefill} onClose={() => { setShowCreate(false); setPrefill(undefined); }} onCreated={(url) => { setLastCreatedUrl(url); loadContracts(); }} />}
      {showClauses && <ClauseManagerModal onClose={() => setShowClauses(false)} />}
      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
