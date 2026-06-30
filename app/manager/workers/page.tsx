"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { CheckCircle2, Copy, Plus, Send, X } from "lucide-react";
import { workerLabel } from "../_format";
import { computeWorkTimes } from "@/lib/workSchedule";
import SurveyRequestModal from "../surveys/SurveyRequestModal";

type WorkType = "AM" | "PM" | "FULL_DAY" | "CUSTOM";
type ServiceStep = "PRE_TRAINING" | "FIELD_TRAINING" | "ADAPTATION";

interface Assignment {
  id: string;
  siteId: string;
  workType: WorkType;
  serviceStep: ServiceStep;
  adaptationStartDate: string | null; // 지원고용 훈련 → 적응지도 전환일(있으면 복합 2단계)
  commuteGuidanceIncluded: boolean;
  attendanceButtonExempt?: boolean;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  startDate: string | null;
  endDate: string | null;
  hasContract?: boolean; // 연결/서명완료 계약서 존재 — 계약파생 필드 변경 경고 게이트
}

// 서비스 단계(지원고용/적응지도) — 문서 세트와 일지 종류를 결정. 현장은 지원고용→적응지도로 전환될 수 있음.
const SERVICE_STEP_OPTIONS: { value: ServiceStep; label: string; desc: string }[] = [
  { value: "FIELD_TRAINING", label: "지원고용 훈련", desc: "(훈련일지/훈련생 종합평가 작성)" },
  { value: "ADAPTATION",     label: "취업 후 적응지도", desc: "(적응지도 일지/종합평가 작성)" },
];

interface Worker {
  id: string;
  workerName: string;
  phoneNumber: string;
  loginId: string;
  planType: string;
  status: string;
  createdAt: string;
  activeAssignment: { siteName: string; agencyName: string; startDate: string; endDate?: string | null; evalStatus?: string | null; assignmentId?: string; assignStatus?: string; workType?: WorkType | null; serviceStep?: ServiceStep; adaptationStartDate?: string | null; requestedWorkTypes?: string | null; replyDeadline?: string | null } | null;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE:   { label: "활성",    tone: "emerald" },
  RESIGNED: { label: "퇴사",    tone: "slate" },
  PAUSED:   { label: "일시정지", tone: "amber" },
};
const PLAN_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  STARTER:  { label: "STARTER",  tone: "sky" },
  STANDARD: { label: "STANDARD", tone: "amber" },
  PRO:      { label: "PRO",      tone: "emerald" },
};
// 배정 파이프라인 상태(assignment-pipeline-design.md): 선정→계약→연결→위치확정→근무→종료
const ASSIGN_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  REQUESTED: { label: "배정 요청 중",   cls: "bg-sky-50 text-sky-600" },
  ACCEPTED:  { label: "수락·확정 대기", cls: "bg-emerald-50 text-emerald-600" },
  ASSIGNED:  { label: "계약 대기",      cls: "bg-amber-50 text-amber-600" },
  CONFIRMED: { label: "연결·위치 대기", cls: "bg-sky-50 text-sky-600" },
  ACTIVE:    { label: "근무중",         cls: "bg-emerald-50 text-emerald-600" },
  ENDED:     { label: "근무 종료",      cls: "bg-slate-100 text-slate-500" },
  EVAL_REQ:  { label: "평가 요청",      cls: "bg-amber-50 text-amber-600" },
  EVAL_DONE: { label: "평가 완료",      cls: "bg-emerald-50 text-emerald-600" },
};

// 근무 종료 = 배정 종료일(현장 근무 종료)이 지난 경우. 평가는 배정(현장) 단위.
function isWorkEnded(a: { endDate?: string | null } | null | undefined): boolean {
  if (!a || !a.endDate) return false;
  return a.endDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}
// 근무형태 짧은 라벨(요청 근무형태 목록 표기용)
const WT_TINY: Record<string, string> = { AM: "오전", PM: "오후", FULL_DAY: "전일", CUSTOM: "직접" };
const PAGE_SIZE = 10;
const WORK_TYPE_LABELS: Record<WorkType, string> = {
  AM:       "오전 (09:00~13:00)",
  PM:       "오후 (13:00~17:00)",
  FULL_DAY: "전일 (09:00~18:00)",
  CUSTOM:   "직접 입력",
};

// 근무형태 버튼용 짧은 라벨(한 줄 배치)
const WORK_TYPE_SHORT: Record<WorkType, string> = {
  AM:       "오전 4시간",
  PM:       "오후 4시간",
  FULL_DAY: "전일 8시간",
  CUSTOM:   "직접 입력",
};

// 근무형태별 기본 시작/종료 시간
const WORK_TYPE_DEFAULTS: Record<WorkType, { start: string; end: string }> = {
  AM:       { start: "09:00", end: "13:00" },
  PM:       { start: "13:00", end: "17:00" },
  FULL_DAY: { start: "09:00", end: "18:00" },
  CUSTOM:   { start: "09:00", end: "18:00" },
};

// ── 배정 요청 모달 ───────────────────────────────────────────────────
// 신규/기존 현장에 직무지도원을 배정 요청. 후보는 ①위탁기관과 계약 이력 있는 직무지도원
// (상태·계약기간 표시) 선택 또는 ②신규 전화번호 직접 추가. 현장 선택 필수.
interface Site { id: string; companyName: string; assignedCount?: number; amCapacity?: number; pmCapacity?: number; fullDayCapacity?: number; }
interface Candidate {
  id: string; name: string; phone: string;
  engaged: boolean; currentStatus: string | null; currentSiteName: string | null;
  periodStart: string | null; periodEnd: string | null;
  // 이력 기반 추천(현장 선택 시 계산)
  experienceCount?: number; sameSite?: boolean; sameBizType?: boolean;
  expired?: boolean; // 이 현장 기한 초과 후보(재요청 대상) — 좌측 목록에 합류
}
type Recipient =
  | { kind: "worker"; workerId: string; name: string; phone: string;
      engaged: boolean; currentSiteName: string | null; periodStart: string | null; periodEnd: string | null }
  | { kind: "new"; name: string; phone: string };
type SentResult = { name: string; phone: string; ok: boolean; kind: "worker" | "new"; code?: string; inviteUrl?: string; error?: string };

const isValidPhone = (p: string) => /^01[0-9]{8,9}$/.test(p.replace(/-/g, "").trim());
const fmtPhone = (p: string) => p.replace(/-/g, "").replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3");
const fmtDate = (iso: string | null) => (iso ? iso.slice(0, 10).replace(/-/g, ".") : "");

function InviteModal({ onClose, initialSiteId, initialWorkTypes, initialDeadline }: { onClose: () => void; initialSiteId?: string; initialWorkTypes?: string[]; initialDeadline?: string }) {
  const [siteId,  setSiteId]  = useState(initialSiteId ?? "");
  const [sites,   setSites]   = useState<Site[]>([]);
  const [siteFilter, setSiteFilter] = useState<"all" | "need" | "full">("all");
  // 요청 근무형태(복수 선택) + 회신 기한 — 이 요청에 속한 모든 후보에 공통 적용
  const [reqWorkTypes, setReqWorkTypes] = useState<string[]>(initialWorkTypes ?? []);
  const [replyDeadline, setReplyDeadline] = useState(initialDeadline ?? "");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candSearch,  setCandSearch]  = useState("");
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [directPhone, setDirectPhone] = useState("");
  const [directName,  setDirectName]  = useState("");

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [results, setResults] = useState<SentResult[] | null>(null);
  // 초기 데이터(현장·후보) 로딩 표시 — 부분 확정 진입 직후 지연 체감 완화
  const [sitesReady, setSitesReady] = useState(false);
  const [candsReady, setCandsReady] = useState(false);
  const initializing = !(sitesReady && candsReady);
  // 부분 확정 후 진입(현장 프리셀렉트): 현장·요청 근무형태는 확정 단계에서 정해졌으므로 잠금
  const lockSite = !!initialSiteId;
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // 이 현장에서 담당자가 '제외(DROPPED)'한 이전 후보 — 복원(상태 변경) 대상
  const [revivable, setRevivable] = useState<{ assignmentId: string; workerName: string; loginId: string; phone: string; status: string }[]>([]);
  const [revivedIds, setRevivedIds] = useState<Set<string>>(new Set()); // 복원(수락)한 후보 — 목록엔 남기되 '복원됨'으로 표시
  // 이 현장 기한 초과(EXPIRED) 후보 — 좌측 후보 목록에 합류시켜 재요청(요청 시 기존 행 재사용)
  const [expiredExtra, setExpiredExtra] = useState<Candidate[]>([]);

  useEffect(() => {
    fetch("/api/admin/sites?pageSize=100")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.items)) setSites(d.items); })
      .catch(() => {})
      .finally(() => setSitesReady(true));
  }, []);

  // 현장 선택 시 그 현장 기준으로 후보를 다시 조회(이력 기반 추천·정렬 반영). 되살리기 후에도 재호출(수락 복원분 제외).
  const loadCandidates = useCallback(() => {
    const url = siteId ? `/api/admin/workers/candidates?siteId=${siteId}` : "/api/admin/workers/candidates";
    fetch(url)
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.items)) setCandidates(d.items); })
      .catch(() => {})
      .finally(() => setCandsReady(true));
  }, [siteId]);
  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  // 이 현장의 이전 후보(탈락/기한초과) 조회 — 부분 재요청 시 우측에서 되살리기
  useEffect(() => {
    if (!siteId) { setRevivable([]); setExpiredExtra([]); return; }
    fetch("/api/admin/assignment-requests", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (!d.success) { setRevivable([]); setExpiredExtra([]); return; }
        const g = (d.groups ?? []).find((x: any) => String(x.siteId) === String(siteId));
        const cands: any[] = g?.candidates ?? [];
        // 제외(DROPPED) → 복원 대상(우측). 기한 초과(EXPIRED) → 좌측 후보 목록 합류(재요청).
        setRevivable(cands.filter(c => c.status === "DROPPED"));
        setExpiredExtra(cands.filter(c => c.status === "EXPIRED").map(c => ({
          id: String(c.workerId), name: c.workerName, phone: c.phone,
          engaged: false, currentStatus: "EXPIRED", currentSiteName: null,
          periodStart: null, periodEnd: null, experienceCount: 0, sameSite: false, sameBizType: false, expired: true,
        })));
      })
      .catch(() => { setRevivable([]); setExpiredExtra([]); });
  }, [siteId]);

  // 정원(근무형태별 합) 대비 배정수로 충원 여부 판정. 정원 미설정(0)이면 배정 0=충원필요.
  const siteCap = (s: Site) => (s.amCapacity ?? 0) + (s.pmCapacity ?? 0) + (s.fullDayCapacity ?? 0);
  const isUnderstaffed = (s: Site) => {
    const cap = siteCap(s);
    const n = s.assignedCount ?? 0;
    return cap > 0 ? n < cap : n === 0;
  };
  const filteredSites = useMemo(() => sites.filter(s => {
    if (siteFilter === "need") return isUnderstaffed(s);
    if (siteFilter === "full") return !isUnderstaffed(s);
    return true;
  }), [sites, siteFilter]);

  const selectedWorkerIds = new Set(recipients.filter(r => r.kind === "worker").map(r => (r as any).workerId));
  const selectedPhones = new Set(recipients.map(r => r.phone.replace(/-/g, "").trim()));

  const filteredCandidates = useMemo(() => {
    const q = candSearch.trim();
    // 기한 초과 재요청 후보를 앞에 합류 + id 중복 제거
    const seen = new Set<string>();
    const pool = [...expiredExtra, ...candidates].filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; });
    return pool.filter(c => {
      if (selectedWorkerIds.has(c.id)) return false; // 이미 선택됨
      if (onlyUnassigned && c.engaged) return false; // 미배정만 필터
      if (!q) return true;
      return c.name.includes(q) || c.phone.replace(/-/g, "").includes(q.replace(/-/g, ""));
    });
  }, [candidates, expiredExtra, candSearch, recipients, onlyUnassigned]);

  function addWorker(c: Candidate) {
    setError("");
    setRecipients(rs => [...rs, {
      kind: "worker", workerId: c.id, name: c.name, phone: c.phone,
      engaged: c.engaged, currentSiteName: c.currentSiteName, periodStart: c.periodStart, periodEnd: c.periodEnd,
    }]);
  }
  function addAllFiltered() {
    if (filteredCandidates.length === 0) return;
    setError("");
    setRecipients(rs => [...rs, ...filteredCandidates.map(c => ({
      kind: "worker" as const, workerId: c.id, name: c.name, phone: c.phone,
      engaged: c.engaged, currentSiteName: c.currentSiteName, periodStart: c.periodStart, periodEnd: c.periodEnd,
    }))]);
  }
  function clearRecipients() { setRecipients([]); setError(""); }
  async function addDirect() {
    const phone = directPhone.replace(/-/g, "").trim();
    if (!isValidPhone(phone)) { setError("올바른 휴대전화번호를 입력하세요."); return; }
    if (selectedPhones.has(phone)) { setError("이미 추가된 전화번호입니다."); return; }
    setError("");
    try {
      // 이미 가입된 직무지도원이면 신규 초대가 아니라 기존 워커 배정 요청으로 추가
      const res = await fetch(`/api/admin/workers/by-phone?phone=${phone}`);
      const d = await res.json();
      if (d.success && d.exists && d.worker) {
        if (!d.worker.active) { setError("비활성 계정이라 배정 요청할 수 없습니다."); return; }
        if (selectedWorkerIds.has(d.worker.id)) { setError("이미 추가된 직무지도원입니다."); return; }
        setRecipients(rs => [...rs, {
          kind: "worker", workerId: d.worker.id, name: d.worker.name, phone: d.worker.phone,
          engaged: d.worker.engaged, currentSiteName: d.worker.currentSiteName,
          periodStart: d.worker.periodStart, periodEnd: d.worker.periodEnd,
        }]);
      } else {
        setRecipients(rs => [...rs, { kind: "new", name: directName.trim(), phone }]);
      }
    } catch {
      // 조회 실패 시 신규로 폴백
      setRecipients(rs => [...rs, { kind: "new", name: directName.trim(), phone }]);
    }
    setDirectPhone(""); setDirectName("");
  }
  function removeRecipient(i: number) { setRecipients(rs => rs.filter((_, idx) => idx !== i)); }

  // 되살리기: 탈락/기한초과 후보를 복원(수락했던 건→수락, 미응답→회신 대기). 워커 거절은 대상 아님(목록에 없음).
  async function revive(assignmentId: string) {
    setError("");
    try {
      const res = await fetch("/api/admin/assignment-requests", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", assignmentId }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "상태 변경에 실패했습니다."); return; }
      // 복원 = 수락(ACCEPTED) 상태로 되돌아감. 목록엔 남기되 '복원됨'으로 표시(담당자 혼동 방지). 좌측 신규후보는 다시 불러 수락분 제외.
      setRevivedIds(prev => new Set(prev).add(assignmentId));
      loadCandidates();
    } catch { setError("서버와 연결할 수 없습니다."); }
  }

  async function handleSend() {
    if (!siteId) { setError("배정할 현장을 선택하세요."); return; }
    if (reqWorkTypes.length === 0) { setError("요청 근무형태를 1개 이상 선택하세요."); return; }
    if (!replyDeadline) { setError("회신 기한을 입력하세요."); return; }
    if (replyDeadline < todayStr) { setError("회신 기한은 요청일(오늘)보다 앞설 수 없습니다."); return; }
    if (recipients.length === 0) { setError("배정할 직무지도원을 1명 이상 선택하거나 추가하세요."); return; }
    setError(""); setLoading(true);
    const out: SentResult[] = [];
    for (const r of recipients) {
      try {
        if (r.kind === "worker") {
          // 기존 워커: 배정 요청(REQUESTED) 생성 — 후보 회신(수락) 후 계약 대기로 진행.
          const res = await fetch("/api/admin/assignments", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workerId: r.workerId, siteId, mode: "request", requestedWorkTypes: reqWorkTypes, replyDeadline }),
          });
          const data = await res.json();
          if (data.success) out.push({ name: r.name, phone: r.phone, ok: true, kind: "worker" });
          else out.push({ name: r.name, phone: r.phone, ok: false, kind: "worker", error: data.message });
        } else {
          // 신규 전화번호: 가입 초대 발송
          const res = await fetch("/api/admin/workers/invite", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phoneNumber: r.phone.replace(/-/g, "").trim(), workerName: r.name.trim() || undefined, siteId }),
          });
          const data = await res.json();
          if (data.success) out.push({ name: r.name, phone: r.phone, ok: true, kind: "new", code: data.invite.code, inviteUrl: data.invite.inviteUrl });
          else out.push({ name: r.name, phone: r.phone, ok: false, kind: "new", error: data.message });
        }
      } catch {
        out.push({ name: r.name, phone: r.phone, ok: false, kind: r.kind, error: "서버와 연결할 수 없습니다." });
      }
    }
    setResults(out);
    setLoading(false);
  }

  async function handleCopy(text: string, idx: number) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  const okCount = results?.filter(r => r.ok).length ?? 0;
  const failCount = results ? results.length - okCount : 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  const REQ_WORK_TYPES: { value: string; label: string }[] = [
    { value: "AM", label: "오전" },
    { value: "PM", label: "오후" },
    { value: "FULL_DAY", label: "전일" },
  ];
  function toggleReqWorkType(v: string) {
    setReqWorkTypes(s => (s.includes(v) ? s.filter(x => x !== v) : [...s, v]));
    setError("");
  }

  const SITE_FILTERS: { value: typeof siteFilter; label: string }[] = [
    { value: "all", label: "전체" },
    { value: "need", label: "충원 필요" },
    { value: "full", label: "충원 완료" },
  ];

  return (
    <div className={T.modalOverlay}>
      <div className={`flex w-full flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl ${results ? "max-h-[80vh] max-w-md" : "h-[88vh] max-w-[62rem]"}`}>
        {!results ? (
          <>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900">배정 요청</h2>
                <p className="mt-1 text-sm font-semibold text-slate-400">현장을 선택하고, 배정할 직무지도원을 골라 요청합니다.</p>
              </div>
              <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>

            <div className="-mr-1 flex-1 overflow-y-auto pr-1">
              {initializing ? (
                <div className="flex h-full items-center justify-center py-20">
                  <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
                </div>
              ) : (
              <>
              {/* 현장 선택(필수) + 필터 — 상단 전체 너비 */}
              <div className="mb-5">
                <label className={T.label}>배정 현장(사업체) <span className="font-semibold text-rose-500">*</span></label>
                {lockSite && <p className="mb-2 text-xs font-semibold text-slate-400">배정 확정 단계에서 선택한 현장으로 고정됩니다.</p>}
                {!lockSite && (
                  <div className="mb-2 flex gap-1.5">
                    {SITE_FILTERS.map(f => (
                      <button key={f.value} type="button" onClick={() => setSiteFilter(f.value)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                          siteFilter === f.value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        }`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
                <select value={siteId} disabled={lockSite} onChange={e => { setSiteId(e.target.value); setError(""); }}
                  className={`w-full ${T.select} ${lockSite ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`}>
                  <option value="">현장을 선택하세요</option>
                  {filteredSites.map(s => {
                    const cap = siteCap(s);
                    const n = s.assignedCount ?? 0;
                    const suffix = cap > 0
                      ? ` · 배정 ${n}/정원 ${cap}${n < cap ? " (충원 필요)" : " (충원 완료)"}`
                      : (n > 0 ? ` · 배정 ${n}명` : " · 정원 미설정");
                    return <option key={s.id} value={s.id}>{s.companyName}{suffix}</option>;
                  })}
                </select>
              </div>

              {/* 요청 근무형태(복수) + 회신 기한 — 이 요청 공통 */}
              <div className="mb-5 grid grid-cols-2 gap-5">
                <div>
                  <label className={T.label}>요청 근무형태 <span className="font-semibold text-rose-500">*</span> <span className="font-semibold text-slate-400">{lockSite ? "(배정 확정 부족분으로 고정)" : "(복수 선택)"}</span></label>
                  <div className="flex gap-2">
                    {REQ_WORK_TYPES.map(w => {
                      const on = reqWorkTypes.includes(w.value);
                      return (
                        <button key={w.value} type="button" disabled={lockSite} onClick={() => toggleReqWorkType(w.value)}
                          className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-bold transition active:scale-95 ${
                            on ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                          } ${lockSite ? "cursor-not-allowed opacity-60 active:scale-100" : ""}`}>
                          {w.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className={T.label}>회신 기한 <span className="font-semibold text-rose-500">*</span> <span className="font-semibold text-slate-400">(이후 미회신 자동 탈락)</span></label>
                  <input type="date" value={replyDeadline} min={todayStr}
                    onChange={e => { setReplyDeadline(e.target.value); setError(""); }} className={`w-full ${T.input}`} />
                </div>
              </div>

              {/* 좌: 후보 + 직접추가 / 우: 배정 대상 */}
              <div className="grid grid-cols-2 gap-5">
                {/* 좌측 */}
                <div className="space-y-4">
                  {/* 후보 직무지도원(계약 이력) 선택 */}
                  <div>
                    <label className={T.label}>직무지도원 후보 <span className="font-semibold text-slate-400">(계약 이력)</span></label>
                    <div className="flex items-center gap-2">
                      <input type="text" placeholder="이름 또는 전화번호 검색" value={candSearch}
                        onChange={e => setCandSearch(e.target.value)} className={`min-w-0 flex-1 ${T.input}`} />
                      <button type="button" onClick={() => setOnlyUnassigned(v => !v)}
                        className={`flex-shrink-0 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-bold transition ${
                          onlyUnassigned ? "border-slate-950 bg-slate-950 text-white" : "border-slate-300 text-slate-600 hover:bg-slate-50"
                        }`}>미배정</button>
                      <button type="button" onClick={addAllFiltered} disabled={filteredCandidates.length === 0}
                        className="flex-shrink-0 whitespace-nowrap rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">
                        일괄 등록{filteredCandidates.length > 0 ? ` ${filteredCandidates.length}` : ""}
                      </button>
                    </div>
                    <div className="mt-2 max-h-[30vh] space-y-1.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                      {filteredCandidates.length === 0 ? (
                        <p className="px-1 py-3 text-center text-sm font-semibold text-slate-300">
                          {candidates.length === 0 ? "계약 이력이 있는 직무지도원이 없습니다." : "검색 결과가 없습니다."}
                        </p>
                      ) : filteredCandidates.map(c => (
                        <button key={c.id} type="button" onClick={() => addWorker(c)}
                          className="group flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-950 hover:bg-slate-50">
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-black text-slate-900">
                              <span className="truncate">{c.name}</span>
                              {c.expired
                                ? <span className={`${T.badge} shrink-0 bg-amber-50 text-amber-600`}>기한 초과 · 재요청</span>
                                : c.engaged
                                  ? <span className={`${T.badge} shrink-0 bg-emerald-50 text-emerald-600`}>근무중</span>
                                  : <span className={`${T.badge} shrink-0 bg-slate-100 text-slate-500`}>미배정</span>}
                              {c.sameSite
                                ? <span className={`${T.badge} shrink-0 bg-sky-50 text-sky-600`}>이 현장 경험</span>
                                : c.sameBizType
                                  ? <span className={`${T.badge} shrink-0 bg-teal-50 text-teal-600`}>유사 업종</span>
                                  : null}
                            </p>
                            <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                              {fmtPhone(c.phone)}
                              {(c.experienceCount ?? 0) > 0 ? ` · 경험 ${c.experienceCount}건` : ""}
                              {c.engaged ? ` · ${c.currentSiteName ?? "현장"}${c.periodStart ? ` · ${fmtDate(c.periodStart)}~${c.periodEnd ? fmtDate(c.periodEnd) : "무기한"}` : ""}` : ""}
                            </p>
                          </div>
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition group-hover:border-slate-950 group-hover:text-slate-900"><Plus className="h-4 w-4" /></span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 직접 추가(신규 전화번호) */}
                  <div>
                    <label className={T.label}>직접 추가 <span className="font-semibold text-slate-400">(미가입 신규)</span></label>
                    <div className="flex items-center gap-2">
                      <input type="tel" placeholder="01012345678" value={directPhone}
                        onChange={e => setDirectPhone(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") addDirect(); }}
                        className={`min-w-0 flex-1 ${T.input} ${directPhone && !isValidPhone(directPhone) ? "border-rose-300" : ""}`} />
                      <input type="text" placeholder="이름(선택)" value={directName}
                        onChange={e => setDirectName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") addDirect(); }}
                        className={`w-24 ${T.input}`} />
                      <button type="button" onClick={addDirect}
                        className="flex-shrink-0 rounded-lg bg-slate-950 px-2.5 py-2 text-xs font-black text-white transition hover:bg-slate-800">추가</button>
                    </div>
                  </div>
                </div>

                {/* 우측: 이전 후보 되살리기 + 배정 대상 */}
                <div>
                  {revivable.length > 0 && (
                    <div className="mb-4">
                      <label className={T.label}>제외된 후보 <span className="font-semibold text-slate-400">(복원 가능)</span></label>
                      <p className="mb-1.5 text-xs font-semibold text-slate-400">상태 변경을 선택하면 해당 후보자가 기존에 배정 요청을 <span className="font-bold text-emerald-600">수락한 상태로 복원</span>됩니다. 추가 후보자를 선택하려면 좌측에서 검색하여 추가하시면 됩니다.</p>
                      <div className="max-h-[20vh] space-y-1.5 overflow-y-auto rounded-xl border border-amber-100 bg-amber-50/40 p-2">
                        {revivable.map(c => {
                          const revived = revivedIds.has(c.assignmentId);
                          return (
                          <div key={c.assignmentId} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${revived ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 text-sm font-black text-slate-900">
                                <span className="truncate">{c.workerName} <span className="font-semibold text-slate-400">({c.loginId})</span></span>
                                {revived
                                  ? <span className={`${T.badge} shrink-0 bg-emerald-50 text-emerald-600`}>복원됨 · 수락</span>
                                  : <span className={`${T.badge} shrink-0 bg-slate-100 text-slate-500`}>제외</span>}
                              </p>
                              <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">{fmtPhone(c.phone)}{revived ? " · 이미 수락한 상태로 확정 대기" : ""}</p>
                            </div>
                            {revived
                              ? <span className="flex-shrink-0 text-xs font-black text-emerald-600">✓ 복원</span>
                              : <button type="button" onClick={() => revive(c.assignmentId)}
                                  className="flex-shrink-0 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-black text-sky-600 transition hover:bg-sky-50 hover:border-sky-300">상태 변경</button>}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <label className={T.label}>배정 대상 <span className="font-semibold text-slate-400">({recipients.length}명)</span></label>
                    {recipients.length > 0 && (
                      <button type="button" onClick={clearRecipients}
                        className="mb-1 text-xs font-bold text-rose-500 transition hover:text-rose-700">일괄 삭제</button>
                    )}
                  </div>
                  <div className="max-h-[44vh] space-y-1.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 p-2">
                    {recipients.length === 0 ? (
                      <p className="px-1 py-6 text-center text-sm font-semibold text-slate-300">왼쪽에서 직무지도원을 추가하세요.</p>
                    ) : recipients.map((r, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-black text-slate-900">
                            <span className="truncate">{r.name?.trim() || "이름 미입력"}</span>
                            {r.kind === "worker"
                              ? (r.engaged
                                  ? <span className={`${T.badge} shrink-0 bg-emerald-50 text-emerald-600`}>근무중</span>
                                  : <span className={`${T.badge} shrink-0 bg-slate-100 text-slate-500`}>미배정</span>)
                              : <span className={`${T.badge} shrink-0 bg-sky-50 text-sky-600`}>신규</span>}
                          </p>
                          <p className="mt-0.5 truncate text-xs font-semibold text-slate-400">
                            {fmtPhone(r.phone)}
                            {r.kind === "worker" && r.engaged ? ` · ${r.currentSiteName ?? "현장"}${r.periodStart ? ` · ${fmtDate(r.periodStart)}~${r.periodEnd ? fmtDate(r.periodEnd) : "무기한"}` : ""}` : ""}
                          </p>
                        </div>
                        <button type="button" onClick={() => removeRecipient(i)}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              </>
              )}
            </div>

            {error && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className={T.btnSecondary}>취소</button>
              <button onClick={handleSend} disabled={loading}
                className={`${T.btnPrimary} flex items-center gap-1.5`}>
                <Send className="h-3.5 w-3.5" />
                {loading ? "요청 중..." : `${recipients.length}명 배정 요청`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-lg font-black text-slate-900">배정 요청 완료</p>
                  <p className="text-sm font-bold text-slate-500">성공 {okCount}명{failCount > 0 ? ` · 실패 ${failCount}명` : ""}</p>
                </div>
              </div>
              <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
            </div>

            <div className="-mr-1 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
              {results.map((r, i) => (
                <div key={i} className={`rounded-xl border p-3 ${r.ok ? "border-slate-200 bg-slate-50" : "border-rose-200 bg-rose-50"}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-[15px] font-black text-slate-900">
                      {r.name?.trim() || "이름 미입력"} <span className="font-bold text-slate-500">{fmtPhone(r.phone)}</span>
                    </p>
                    {!r.ok && <span className="text-sm font-black text-rose-600">실패</span>}
                  </div>
                  {r.ok ? (
                    r.kind === "worker" ? (
                      <p className="mt-1 text-sm font-bold text-sky-600">배정 요청 발송됨 (회신 대기) — 후보가 수락하면 계약 대기로 넘어갑니다.</p>
                    ) : (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="rounded-lg bg-white px-2.5 py-1.5 text-lg font-black tracking-[4px] text-slate-900">{r.code}</span>
                        <button onClick={() => r.inviteUrl && handleCopy(r.inviteUrl, i)}
                          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100">
                          <Copy className="h-4 w-4" />{copiedIdx === i ? "복사됨!" : "링크 복사"}
                        </button>
                      </div>
                    )
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-rose-600">{r.error}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end">
              <button onClick={onClose} className={T.btnPrimary}>확인</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function WorkScheduleModal({ worker, assignmentId, initial, onClose, onSaved, onSurveySent, onCancelled }: {
  worker: Worker; assignmentId: string; initial: Assignment;
  onClose: () => void; onSaved: (updated: Assignment) => void; onSurveySent?: () => void; onCancelled?: () => void;
}) {
  const [workType, setWorkType] = useState<WorkType>(initial.workType ?? "FULL_DAY");
  // 현장 구분(복수 선택): 지원고용 훈련 / 적응지도. 둘 다면 전환일 기준 1배정을 단계 분할.
  // 초기값: 전환일 있으면 둘 다, 없으면 serviceStep 단건.
  const initDual = !!initial.adaptationStartDate;
  const [wantField, setWantField] = useState(initDual || initial.serviceStep !== "ADAPTATION");
  const [wantAdapt, setWantAdapt] = useState(initDual || initial.serviceStep === "ADAPTATION");
  const [splitDate, setSplitDate] = useState(initial.adaptationStartDate ? initial.adaptationStartDate.slice(0, 10) : "");
  const [commuteGuidanceIncluded, setCommuteGuidanceIncluded] = useState(initial.commuteGuidanceIncluded ?? true);
  // 면제는 운영자 전용 — 매니저 화면에선 읽기 전용으로 표시하고 값은 그대로 보존
  const [attendanceButtonExempt] = useState(initial.attendanceButtonExempt ?? false);
  // 관리자가 설정한 실제 시간 (미설정 시 기본값)
  const [workStart, setWorkStart] = useState(
    initial.customWorkStart ?? WORK_TYPE_DEFAULTS[initial.workType ?? "FULL_DAY"].start
  );
  const [workEnd, setWorkEnd] = useState(
    initial.customWorkEnd ?? WORK_TYPE_DEFAULTS[initial.workType ?? "FULL_DAY"].end
  );
  // 계약(배정) 기간 — 전자계약서 PRO 전용 대비 수동 입력. 접근 판정의 계약기간 역할.
  const [cStart, setCStart] = useState(initial.startDate ? initial.startDate.slice(0, 10) : "");
  const [cEnd, setCEnd]     = useState(initial.endDate ? initial.endDate.slice(0, 10) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const workEnded = isWorkEnded(worker.activeAssignment);
  // 만족도 평가 요청 — 근무(배정) 종료 + 미요청일 때만(만족도 평가 화면과 동일 배정 키로 동기화·중복 차단)
  const [showSurvey, setShowSurvey] = useState(false);
  const evalStatus = worker.activeAssignment?.evalStatus ?? null;
  const evalRequested = evalStatus === "PENDING" || evalStatus === "RESPONDED";
  const canRequestEval = workEnded && !evalRequested;
  const evalBtnLabel = evalStatus === "RESPONDED" ? "평가 완료됨"
    : evalStatus === "PENDING" ? "평가 요청됨"
    : (evalStatus === "EXPIRED" || evalStatus === "CANCELLED") ? "만족도 평가 재요청"
    : "만족도 평가 요청";
  // 현장(사업체) 담당자 — 평가 요청 시 알림톡 수신자로 자동 입력
  const [bizContact, setBizContact] = useState<{ name: string; phone: string }>({ name: "", phone: "" });
  useEffect(() => {
    if (!initial.siteId) return;
    fetch(`/api/admin/sites/${initial.siteId}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d?.success && d.item) setBizContact({ name: d.item.businessContactName || "", phone: d.item.businessContactPhone || "" }); })
      .catch(() => {});
  }, [initial.siteId]);

  const isFullDay = workType === "FULL_DAY";

  // 계약 파생 필드(근무형태·근로계약 기간·출퇴근 지도 포함 여부)가 초기값에서 바뀌었는지 감지.
  // 현장 구분(지원고용↔적응지도 전환)은 6개월 장기 계약 내 '단계 전환'이라 계약 변경이 아니므로 제외.
  // 변경되면: 좌하단 '계약서 재작성·발송' 버튼을 깜빡여 유도하고, 저장은 막아 계약서부터 재작성하게 한다.
  const initWorkType = initial.workType ?? "FULL_DAY";
  const initStart = initial.startDate ? initial.startDate.slice(0, 10) : "";
  const initEnd = initial.endDate ? initial.endDate.slice(0, 10) : "";
  const initCommute = initial.commuteGuidanceIncluded ?? true;
  // 배정 기간(cStart/cEnd)은 계약과 별개 → 계약서 재작성 트리거에서 제외(조기 배정 종료가 계약 변경을 요구하면 안 됨).
  const contractDirty =
    workType !== initWorkType ||
    (!isFullDay && commuteGuidanceIncluded !== initCommute) ||
    (workType === "CUSTOM" && (
      workStart !== (initial.customWorkStart ?? WORK_TYPE_DEFAULTS.CUSTOM.start) ||
      workEnd !== (initial.customWorkEnd ?? WORK_TYPE_DEFAULTS.CUSTOM.end)
    ));
  // 계약서가 연결돼 있고 계약 파생 필드가 바뀐 경우에만 재작성 유도(신규 배정 최초 설정은 제외).
  const needsContractRewrite = initial.hasContract && contractDirty;

  // 근무형태 변경 시 기본 시간으로 초기화 (이미 커스텀 값이 있으면 유지)
  function changeWorkType(wt: WorkType) {
    setWorkType(wt);
    const def = WORK_TYPE_DEFAULTS[wt];
    setWorkStart(def.start);
    setWorkEnd(def.end);
  }

  async function handleSave() {
    // 계약 파생 필드가 바뀌었는데 계약서가 연결돼 있으면 저장 차단 → 계약서부터 재작성·발송.
    if (needsContractRewrite) {
      alert("근로계약 기간, 근무 형태 등 계약 관련 내용이 변경되었습니다.\n좌측 하단 '계약서 재작성·발송' 버튼을 눌러 수정 근로계약서를 작성하여 발송해 주십시오.");
      return;
    }
    if (!wantField && !wantAdapt) { setError("현장 구분을 1개 이상 선택하세요."); return; }
    if (!cStart || !cEnd) { setError("배정 시작일과 종료일을 모두 입력하세요."); return; }
    if (cEnd < cStart) { setError("배정 종료일은 시작일 이후여야 합니다."); return; }
    const dual = wantField && wantAdapt;
    if (dual) {
      if (!splitDate) { setError("적응지도 전환일을 입력하세요."); return; }
      if (cStart && splitDate <= cStart) { setError("전환일은 계약 시작일 이후여야 합니다."); return; }
      if (cEnd && splitDate > cEnd) { setError("전환일은 계약 종료일 이내여야 합니다."); return; }
    }
    // 둘 다 → FIELD_TRAINING + 전환일(이후 적응지도) / 단건 → 해당 구분, 전환일 없음
    const newServiceStep: ServiceStep = (wantAdapt && !wantField) ? "ADAPTATION" : "FIELD_TRAINING";
    const newAdaptationStart = dual ? splitDate : null;

    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workType,
          serviceStep: newServiceStep,
          adaptationStartDate: newAdaptationStart, // null이면 단건으로 초기화
          commuteGuidanceIncluded: isFullDay ? false : commuteGuidanceIncluded,
          attendanceButtonExempt,
          customWorkStart: workStart,
          customWorkEnd:   workEnd,
          startDate: cStart || undefined,
          endDate:   cEnd,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      onSaved({
        ...initial, workType, serviceStep: newServiceStep,
        adaptationStartDate: newAdaptationStart ? new Date(newAdaptationStart).toISOString() : null,
        commuteGuidanceIncluded: isFullDay ? false : commuteGuidanceIncluded,
        attendanceButtonExempt,
        customWorkStart: workStart,
        customWorkEnd:   workEnd,
        startDate: cStart ? new Date(cStart).toISOString() : initial.startDate,
        endDate:   cEnd ? new Date(cEnd).toISOString() : null,
      });
      onClose();
    } catch (e: any) {
      setError(e.message || "저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  async function handleCancelAssignment() {
    if (!confirm("이 배정을 취소(종료)하시겠습니까?\n종료 후 다른 현장으로 재배정할 수 있습니다.")) return;
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      onCancelled?.();
    } catch (e: any) {
      setError(e.message || "배정 취소에 실패했습니다.");
    } finally { setSaving(false); }
  }

  // 출근부에 자동 기록되는 실제 근무 시각(출퇴근 지도·휴게 포함) — workSchedule SSOT 기준
  const effCommute = isFullDay ? false : commuteGuidanceIncluded;
  const actual = computeWorkTimes(workType, effCommute, workStart, workEnd);
  // 실제 근무 시간 창의 길이 표기 (전일은 점심 1H 공제 안내)
  function actualLabel() {
    const [sh, sm] = actual.start.split(":").map(Number);
    const [eh, em] = actual.end.split(":").map(Number);
    const min = (eh * 60 + em) - (sh * 60 + sm);
    if (min <= 0) return "0H";
    return isFullDay
      ? `총 ${(min / 60).toFixed(1)}H · 점심 1H 공제(인정 ${((min - 60) / 60).toFixed(1)}H)`
      : `총 ${(min / 60).toFixed(1)}H`;
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="w-full max-w-[62rem] max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">배정 설정 상세</h2>
            <p className="mt-0.5 text-[13px] font-semibold text-slate-400">{worker.workerName} · {worker.activeAssignment?.siteName}</p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-5">
        {/* 현장 구분(복수 선택) — 지원고용 훈련 / 적응지도. 둘 다면 전환일로 단계 분할 */}
        <div>
          {/* 둘 다 선택 시 좌(현장 구분+버튼)/우(전환일+입력) 2열, 타이틀 상단 정렬 */}
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <label className={T.label}>현장 구분 <span className="font-semibold text-slate-400">(복수 선택 가능)</span></label>
              <div className="flex items-stretch gap-2">
                {SERVICE_STEP_OPTIONS.map(opt => {
                  const on = opt.value === "ADAPTATION" ? wantAdapt : wantField;
                  const toggle = () => opt.value === "ADAPTATION" ? setWantAdapt(v => !v) : setWantField(v => !v);
                  return (
                    <button key={opt.value} type="button" onClick={toggle}
                      className={`flex min-w-0 flex-1 items-baseline gap-1.5 rounded-xl border px-3 py-2.5 text-left transition active:scale-95 ${
                        on ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      }`}>
                      <span className={`whitespace-nowrap text-sm ${on ? "font-black" : "font-semibold"}`}>{opt.label}</span>
                      <span className={`truncate text-xs ${on ? "text-slate-300" : "text-slate-400"}`}>{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {wantField && wantAdapt && (
              <div className="shrink-0">
                <label className={T.label}>전환일</label>
                <input type="date" value={splitDate} min={cStart || undefined} max={cEnd || undefined}
                  onChange={e => setSplitDate(e.target.value)} className={`w-40 ${T.input}`} />
              </div>
            )}
          </div>
          <p className="mt-1.5 text-xs font-semibold text-slate-400">현장을 모두 선택할 경우, 설정한 날짜를 기준으로 취업 후 적응지도로 전환되며 기존 작성 일지는 보존됩니다.</p>
        </div>

        {/* 배정 기간(현장 근무) — 이 현장에서의 근무 기간. 종료일 경과 = 근무 종료(평가 대상). 근로계약 기간(6개월)과는 별개. */}
        <div>
          <label className={T.label}>배정 기간 <span className="font-semibold text-slate-400">(이 현장 근무 기간)</span></label>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={cStart} max={cEnd || undefined} onChange={e => setCStart(e.target.value)} className={`w-40 ${T.input}`} />
            <span className="font-semibold text-slate-400">~</span>
            <input type="date" value={cEnd} min={cStart || undefined} onChange={e => setCEnd(e.target.value)} className={`w-40 ${T.input}`} />
            <button type="button" onClick={() => setCEnd(new Date().toISOString().slice(0, 10))}
              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 transition hover:bg-rose-100">오늘로 배정 종료</button>
          </div>
          <p className="mt-1 text-xs font-semibold text-slate-400">현장 근무가 끝나면 종료일을 그날로 설정하세요. 종료일이 지나면 ‘근무 종료’가 되어 평가 요청 대상이 됩니다. (전체 근로계약 기간과는 별개)</p>
        </div>

        {/* 근무형태 — 한 줄 배치(작게). CUSTOM만 직접 시간 입력 */}
        <div>
          <label className={T.label}>근무형태</label>
          <div className="grid grid-cols-4 gap-2">
            {(["AM", "PM", "FULL_DAY", "CUSTOM"] as WorkType[]).map(wt => (
              <button key={wt} type="button" onClick={() => changeWorkType(wt)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                  workType === wt ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}>
                {WORK_TYPE_SHORT[wt]}
              </button>
            ))}
          </div>
          {workType === "CUSTOM" && (
            <div className="mt-2 flex items-center justify-end gap-2">
              <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)} className={`w-32 ${T.input}`} />
              <span className="text-slate-400 font-semibold">~</span>
              <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)} className={`w-32 ${T.input}`} />
            </div>
          )}
        </div>

        {/* 출퇴근 지도 포함 여부 + 휴게시간 안내(옆) */}
        <div>
          <label className={T.label}>출퇴근 지도 포함 여부</label>
          {isFullDay ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm font-semibold text-slate-500">
              전일 근무는 출퇴근 지도를 포함할 수 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <input type="checkbox" checked={commuteGuidanceIncluded}
                  onChange={e => setCommuteGuidanceIncluded(e.target.checked)}
                  className="h-4 w-4 flex-shrink-0 accent-slate-950" />
                <span className="text-sm font-black text-slate-900">출퇴근 지도 포함 (+60분) <span className="font-semibold text-slate-400">출근 30분 + 퇴근 30분</span></span>
              </label>
              <p className="flex items-center text-xs font-bold text-rose-600">
                ※ 휴게시간 지도(30분)는 4시간 근무 시 기본값으로 포함됩니다.
              </p>
            </div>
          )}
        </div>

        {/* 실제 근무 시간(자동) + 출근부 자동작성 안내(옆) */}
        <div>
          <label className={T.label}>실제 근무 시간 <span className="font-semibold text-slate-400">(출퇴근 지도 및 휴게시간 포함)</span></label>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-900">
              {actual.start} ~ {actual.end}
              <span className="ml-2 text-xs font-semibold text-slate-400">{actualLabel()}</span>
            </div>
            <span className="text-xs font-bold text-rose-600">※ 출근부에는 해당 시간으로 자동 작성됩니다.</span>
          </div>
        </div>

        {/* 출퇴근 관리 면제(시프티 병행) — 운영자 전용. 매니저는 현재 상태만 확인 */}
        <div>
          <label className={T.label}>출퇴근 관리 면제 여부</label>
          <div className={`flex items-center gap-3 rounded-xl border p-3 ${
            attendanceButtonExempt ? "border-rose-200 bg-rose-50" : "border-sky-200 bg-sky-50"
          }`}>
            <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-black ${
              attendanceButtonExempt ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"
            }`}>
              {attendanceButtonExempt ? "면제 중" : "정상(버튼 사용)"}
            </span>
            <div>
              <span className="text-sm font-black text-slate-900">출퇴근 버튼 없이 자동 출근부 작성</span>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">
                면제 시 직무지도원이 출퇴근 버튼을 누르지 않아도 근무형태 기준으로 출근부가 자동 작성됩니다. 면제 여부 변경은 시스템 운영자만 가능합니다.
              </p>
            </div>
          </div>
        </div>
        </div>

        {error && <p className="mb-3 mt-5 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-7 flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* 근무 종료된 배정은 계약(근로) 종료 → 계약서 작성·발송 숨김(소급 발급은 '근로계약서 관리'에서 가능). 대신 만족도 평가 요청 활성. */}
            {!workEnded && (
              <button
                type="button"
                onClick={() => { window.location.href = `/manager/contracts?assignmentId=${assignmentId}&workerId=${worker.id}`; }}
                className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold transition ${
                  needsContractRewrite
                    ? "animate-pulse border-rose-400 bg-rose-100 font-black text-rose-700 ring-2 ring-rose-300 hover:bg-rose-200"
                    : initial.hasContract
                      ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                      : "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                }`}
              >
                {initial.hasContract ? "계약서 재작성·발송" : "계약서 작성·발송"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowSurvey(true)}
              disabled={!canRequestEval}
              title={canRequestEval ? undefined : (!workEnded ? "근무(배정)가 종료된 후에 평가를 요청할 수 있습니다." : "이미 평가가 요청되었습니다.")}
              className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold transition ${
                canRequestEval
                  ? "animate-pulse border-rose-400 bg-rose-100 font-black text-rose-700 ring-2 ring-rose-300 hover:bg-rose-200"
                  : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
              }`}
            >
              {evalBtnLabel}
            </button>
            {!workEnded && (
              <button type="button" onClick={handleCancelAssignment} disabled={saving} className={T.btnDanger}>
                배정 취소
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className={T.btnSecondary}>닫기</button>
            <button onClick={handleSave} disabled={saving} className={T.btnPrimary}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>

    {showSurvey && (
      <SurveyRequestModal
        prefillWorker={{
          id: worker.id,
          workerName: worker.workerName,
          phoneNumber: worker.phoneNumber,
          siteName: worker.activeAssignment?.siteName ?? null,
          recipientName: bizContact.name,
          recipientPhone: bizContact.phone,
          assignmentId: worker.activeAssignment?.assignmentId ?? null,
        }}
        onClose={() => setShowSurvey(false)}
        onCreated={() => { setShowSurvey(false); onSurveySent?.(); }}
      />
    )}
    </>
  );
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [assignState, setAssignState] = useState<string[]>([]); // 배정 현황 필터(근무중/계약대기/근무종료)
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [editTarget,     setEditTarget]     = useState<{ worker: Worker; assignment: Assignment } | null>(null);
  const [showInvite,     setShowInvite]     = useState(false);
  const [inviteSiteId,   setInviteSiteId]   = useState<string>(""); // 배정 확정 부분확정 후 자동 진입 시 현장 프리셀렉트
  const [inviteWts,      setInviteWts]      = useState<string[]>([]); // 프리필 요청 근무형태(부족분)
  const [inviteDeadline, setInviteDeadline] = useState<string>("");  // 프리필 회신 기한
  const [assignmentMap, setAssignmentMap] = useState<Record<string, Assignment>>({});

  // 딥링크: ?q=검색 / ?requestSite=현장&wt=근무형태&deadline=기한 (배정 확정 부분확정 후 추가 모집 자동 진입)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sq = params.get("q");
    if (sq) setQuery(sq);
    const as = params.get("assignState"); // 대시보드 '근무 종료 — 평가 미요청' 딥링크
    if (as) setAssignState(as.split(",").filter(Boolean));
    const rs = params.get("requestSite");
    if (rs) {
      setInviteSiteId(rs);
      setInviteWts((params.get("wt") || "").split(",").filter(Boolean));
      setInviteDeadline(params.get("deadline") || "");
      setShowInvite(true);
      window.history.replaceState(null, "", "/manager/workers");
    }
  }, []);

  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick(t => t + 1);

  // 검색어 디바운스(키 입력마다 조회 방지)
  useEffect(() => { const t = setTimeout(() => setDebouncedQuery(query), 300); return () => clearTimeout(t); }, [query]);
  // 검색/필터 변경 시 1페이지로
  useEffect(() => { setPage(1); }, [debouncedQuery, assignState]);
  // 서버 페이지네이션 조회(page/검색/상태 변경 또는 수동 갱신 시)
  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (assignState.length) params.set("assignState", assignState.join(","));
    fetch(`/api/admin/workers?${params.toString()}`)
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) { setWorkers(d.data); setTotal(d.total ?? 0); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, debouncedQuery, assignState, reloadTick]);

  async function openEdit(worker: Worker) {
    const assignmentId = worker.activeAssignment?.assignmentId;
    if (!assignmentId) return alert("배정된 현장이 없습니다.");
    if (!assignmentMap[assignmentId]) {
      try {
        const res = await fetch(`/api/admin/assignments?workerId=${worker.id}`);
        const data = await res.json();
        if (data.success && data.items?.length > 0) {
          const item = data.items.find((i: any) => i.id === assignmentId) ?? data.items[0];
          const asgn: Assignment = {
            id: item.id, siteId: String(item.siteId ?? item.site?.id ?? ""),
            workType: (item.workType as WorkType) ?? "FULL_DAY",
            serviceStep: (item.serviceStep as ServiceStep) ?? "FIELD_TRAINING",
            adaptationStartDate: item.adaptationStartDate ?? null,
            commuteGuidanceIncluded: item.commuteGuidanceIncluded ?? true,
            attendanceButtonExempt: item.attendanceButtonExempt ?? false,
            customWorkStart: item.customWorkStart ?? null, customWorkEnd: item.customWorkEnd ?? null,
            startDate: item.startDate ?? null, endDate: item.endDate ?? null,
            hasContract: item.hasContract ?? false,
          };
          setAssignmentMap(prev => ({ ...prev, [assignmentId]: asgn }));
          setEditTarget({ worker, assignment: asgn });
        }
      } catch { alert("배정 정보 조회에 실패했습니다."); }
    } else {
      setEditTarget({ worker, assignment: assignmentMap[assignmentId] });
    }
  }

  // 서버에서 이미 페이지 단위로 받으므로 그대로 사용
  const pageItems = workers;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = debouncedQuery.trim().length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 배정 관리"
        sub="직무지도원의 현장(사업체) 배정 현황을 관리합니다. 신규 배정 요청과 기존 배정 내용 조회와 변경이 가능합니다."
        actions={
          <button onClick={() => setShowInvite(true)} className={`${T.btnPrimary} flex items-center gap-1.5`}>
            <Send className="h-3.5 w-3.5" />배정 요청
          </button>
        }
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="이름 / 전화번호 / 현장(사업체) / 아이디 검색"
        filters={[
          { value: "working", label: "근무중" },
          { value: "pending_contract", label: "계약 대기" },
          { value: "ending", label: "배정 종료 임박" },
          { value: "ended", label: "근무 종료" },
        ]}
        selected={assignState}
        onToggleFilter={(v) => setAssignState(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v])}
      />

      <div className={T.tableWrap}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] border-collapse">
          <thead>
            <tr>
              {["직무지도원 성명(아이디)", "전화번호", "현장(사업체)", "현장 구분", "위탁기관명", "근무형태", "배정일", "플랜", "배정 현황"].map(h => (
                <th key={h} className={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.tdCenter}>로딩 중...</td></tr>
            ) : total === 0 ? (
              <tr><td colSpan={9} className={T.tdCenter}>{hasFilter ? "조건에 맞는 직무지도원이 없습니다." : "직무지도원이 없습니다."}</td></tr>
            ) : pageItems.map(c => {
              const assignmentId = c.activeAssignment?.assignmentId;
              const cachedAsgn = assignmentId ? assignmentMap[assignmentId] : null;
              // 근무형태는 목록 API(activeAssignment.workType)에서 항상 표기.
              // 저장 후엔 캐시(cachedAsgn)가 우선 — 행 열람/취소만으로는 표기가 바뀌지 않음.
              const wt = (cachedAsgn?.workType ?? c.activeAssignment?.workType) as WorkType | undefined;
              const reqWts = c.activeAssignment?.requestedWorkTypes;
              const workTypeLabel = wt
                ? WORK_TYPE_LABELS[wt]
                : (c.activeAssignment?.assignStatus === "REQUESTED" && reqWts
                    ? `요청: ${reqWts.split(",").map(w => WT_TINY[w] ?? w).join("·")}`
                    : (c.activeAssignment ? "미설정" : "-"));
              // 현장 구분: 전환일 있으면 복합(2단계), 없으면 단건
              const adaptStart = cachedAsgn?.adaptationStartDate ?? c.activeAssignment?.adaptationStartDate ?? null;
              const step = (cachedAsgn?.serviceStep ?? c.activeAssignment?.serviceStep) as ServiceStep | undefined;
              return (
                <tr key={c.id}
                  className={`${T.trBase} ${c.activeAssignment ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  onClick={() => c.activeAssignment && openEdit(c)}>
                  <td className={`${T.td} whitespace-nowrap`}><span className="font-semibold text-sky-600">{workerLabel(c.workerName, c.loginId)}</span></td>
                  <td className={T.td}>{c.phoneNumber}</td>
                  <td className={`${T.td} whitespace-nowrap`}>
                    <div className="max-w-[140px] truncate">
                      {c.activeAssignment?.siteName
                        ? c.activeAssignment.siteName
                        : <span className="text-slate-400">미배정</span>}
                    </div>
                  </td>
                  <td className={`${T.td} whitespace-nowrap`}>
                    {!c.activeAssignment ? "-"
                      : adaptStart
                        ? <span className={`${T.badge} bg-teal-50 text-teal-600`}>복합 2단계</span>
                        : <span className="text-slate-700">{step === "ADAPTATION" ? "적응지도" : "지원고용 훈련"}</span>}
                  </td>
                  <td className={`${T.td} whitespace-nowrap`}><div className="max-w-[160px] truncate" title={c.activeAssignment?.agencyName || undefined}>{c.activeAssignment?.agencyName || "-"}</div></td>
                  <td className={`${T.td} whitespace-nowrap`}>
                    {c.activeAssignment
                      ? <span className="text-slate-700">{workTypeLabel}</span>
                      : "-"}
                  </td>
                  <td className={`${T.td} whitespace-nowrap`}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td className={T.td}>
                    {c.planType && c.planType !== "FREE"
                      ? <StatusBadge status={c.planType === "PREMIUM" ? "PRO" : c.planType} map={PLAN_BADGE} />
                      : <span className="text-[13px] text-slate-300">무료</span>}
                  </td>
                  <td className={T.td}>
                    {(() => {
                      const ended = isWorkEnded(c.activeAssignment);
                      const ev = c.activeAssignment?.evalStatus;
                      // 평가 상태 우선(만족도 평가와 동기화) → 근무 종료 → 배정 파이프라인
                      const key = ev === "RESPONDED" ? "EVAL_DONE"
                        : ev === "PENDING" ? "EVAL_REQ"
                        : ended ? "ENDED"
                        : c.activeAssignment?.assignStatus;
                      return key && ASSIGN_STATUS_BADGE[key]
                        ? <span className={`${T.badge} shrink-0 ${ASSIGN_STATUS_BADGE[key].cls}`}>{ASSIGN_STATUS_BADGE[key].label}</span>
                        : <span className="text-[13px] text-slate-300">-</span>;
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
      </div>

      {editTarget && (
        <WorkScheduleModal
          worker={editTarget.worker}
          assignmentId={editTarget.assignment.id}
          initial={editTarget.assignment}
          onClose={() => setEditTarget(null)}
          onSaved={updated => setAssignmentMap(prev => ({ ...prev, [updated.id]: updated }))}
          onSurveySent={() => { setEditTarget(null); reload(); }}
          onCancelled={() => { setEditTarget(null); reload(); }}
        />
      )}

      {showInvite && <InviteModal initialSiteId={inviteSiteId} initialWorkTypes={inviteWts} initialDeadline={inviteDeadline} onClose={() => { setShowInvite(false); setInviteSiteId(""); setInviteWts([]); setInviteDeadline(""); reload(); }} />}
    </div>
  );
}
