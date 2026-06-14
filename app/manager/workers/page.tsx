"use client";

import { useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { CheckCircle2, Copy, Send, X } from "lucide-react";
import { workerLabel } from "../_format";
import { computeWorkTimes } from "@/lib/workSchedule";

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
  activeAssignment: { siteName: string; agencyName: string; startDate: string; assignmentId?: string; assignStatus?: string; workType?: WorkType; serviceStep?: ServiceStep; adaptationStartDate?: string | null } | null;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE:   { label: "활성",    tone: "emerald" },
  RESIGNED: { label: "퇴사",    tone: "slate" },
  PAUSED:   { label: "일시정지", tone: "amber" },
};
const PLAN_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  STARTER:  { label: "STARTER",  tone: "sky" },
  STANDARD: { label: "STANDARD", tone: "violet" },
  PRO:      { label: "PRO",      tone: "emerald" },
};
// 배정 파이프라인 상태(assignment-pipeline-design.md): 선정→계약→연결→위치확정→근무
const ASSIGN_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ASSIGNED:  { label: "계약 대기",      cls: "bg-amber-50 text-amber-600" },
  CONFIRMED: { label: "연결·위치 대기", cls: "bg-sky-50 text-sky-600" },
  ACTIVE:    { label: "근무중",         cls: "bg-emerald-50 text-emerald-600" },
};
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

// ── 초대 링크 발송 모달 (멀티/지정) ───────────────────────────────────
interface Site { id: string; companyName: string; }
type Recipient = { phone: string; name: string };
type SentResult = { phone: string; name: string; ok: boolean; code?: string; inviteUrl?: string; error?: string };

const isValidPhone = (p: string) => /^01[0-9]{8,9}$/.test(p.replace(/-/g, "").trim());

function InviteModal({ onClose }: { onClose: () => void }) {
  const [siteId,  setSiteId]  = useState("");
  const [sites,   setSites]   = useState<Site[]>([]);
  const [rows,    setRows]    = useState<Recipient[]>([{ phone: "", name: "" }]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [results, setResults] = useState<SentResult[] | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/sites?pageSize=100")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.items)) setSites(d.items); })
      .catch(() => {});
  }, []);

  function updateRow(i: number, patch: Partial<Recipient>) {
    setRows(rs => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setError("");
  }
  function addRow() { setRows(rs => [...rs, { phone: "", name: "" }]); }
  function removeRow(i: number) { setRows(rs => (rs.length === 1 ? rs : rs.filter((_, idx) => idx !== i))); }

  const validRows = rows.filter(r => isValidPhone(r.phone));

  async function handleSend() {
    // 중복 번호 가드
    const nums = validRows.map(r => r.phone.replace(/-/g, "").trim());
    if (new Set(nums).size !== nums.length) { setError("중복된 전화번호가 있습니다."); return; }
    if (validRows.length === 0) { setError("유효한 휴대전화번호를 1개 이상 입력하세요."); return; }
    setError(""); setLoading(true);
    const out: SentResult[] = [];
    for (const r of validRows) {
      try {
        const res = await fetch("/api/admin/workers/invite", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneNumber: r.phone.replace(/-/g, "").trim(),
            workerName: r.name.trim() || undefined,
            siteId: siteId || undefined,
          }),
        });
        const data = await res.json();
        if (data.success) out.push({ phone: r.phone, name: r.name, ok: true, code: data.invite.code, inviteUrl: data.invite.inviteUrl });
        else out.push({ phone: r.phone, name: r.name, ok: false, error: data.message });
      } catch {
        out.push({ phone: r.phone, name: r.name, ok: false, error: "서버와 연결할 수 없습니다." });
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

  return (
    <div className={T.modalOverlay}>
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white p-6 shadow-2xl">
        {!results ? (
          <>
            <h2 className="mb-1 text-base font-black text-slate-900">직무지도원 초대 (멀티·지정)</h2>
            <p className="mb-4 text-sm font-semibold text-slate-400">후보 1명(지정) 또는 여러 명(멀티)에게 같은 현장으로 초대 링크·인증번호를 발송합니다.</p>

            <div className="mb-4">
              <label className={T.label}>배정 현장(사업체) (선택)</label>
              <select value={siteId} onChange={e => setSiteId(e.target.value)} className={`w-full ${T.select}`}>
                <option value="">현장 미지정</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.companyName}</option>)}
              </select>
            </div>

            <label className={T.label}>후보 <span className="font-semibold text-slate-400">(전화번호 필수 · 이름 선택)</span></label>
            <div className="-mr-1 max-h-[38vh] space-y-2 overflow-y-auto pr-1">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-5 flex-shrink-0 text-center text-xs font-black text-slate-400">{i + 1}</span>
                  <input type="tel" placeholder="01012345678" value={r.phone}
                    onChange={e => updateRow(i, { phone: e.target.value })}
                    className={`flex-1 ${T.input} ${r.phone && !isValidPhone(r.phone) ? "border-rose-300" : ""}`} />
                  <input type="text" placeholder="이름(선택)" value={r.name}
                    onChange={e => updateRow(i, { name: e.target.value })}
                    className={`w-28 ${T.input}`} />
                  <button type="button" onClick={() => removeRow(i)} disabled={rows.length === 1}
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-400 transition hover:bg-slate-50 disabled:opacity-30">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addRow} className="mt-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-bold text-slate-500 transition hover:bg-slate-50">
              + 후보 추가
            </button>

            {error && (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className={T.btnSecondary}>취소</button>
              <button onClick={handleSend} disabled={loading || validRows.length === 0}
                className={`${T.btnPrimary} flex items-center gap-1.5`}>
                <Send className="h-3.5 w-3.5" />
                {loading ? "발송 중..." : `${validRows.length}명 초대 발송`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-black text-slate-900">초대 발송 완료</p>
                <p className="text-xs font-semibold text-slate-400">성공 {okCount}명{failCount > 0 ? ` · 실패 ${failCount}명` : ""}</p>
              </div>
            </div>

            <div className="-mr-1 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {results.map((r, i) => (
                <div key={i} className={`rounded-xl border p-3 ${r.ok ? "border-slate-200 bg-slate-50" : "border-rose-200 bg-rose-50"}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-black text-slate-900">
                      {r.name?.trim() || "이름 미입력"} <span className="font-semibold text-slate-400">{r.phone.replace(/-/g, "").replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}</span>
                    </p>
                    {!r.ok && <span className="text-xs font-bold text-rose-600">실패</span>}
                  </div>
                  {r.ok ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded-lg bg-white px-2 py-1 text-base font-black tracking-[4px] text-slate-900">{r.code}</span>
                      <button onClick={() => r.inviteUrl && handleCopy(r.inviteUrl, i)}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-black text-slate-700 transition hover:bg-slate-100">
                        <Copy className="h-3.5 w-3.5" />{copiedIdx === i ? "복사됨!" : "링크 복사"}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs font-semibold text-rose-600">{r.error}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-700">
                SMS 환경변수(KAKAO_ALIMTALK_*) 설정 시 자동 문자 발송됩니다. 미설정 시 위 링크·인증번호를 직접 전달해주세요.
                수락한 후보는 <b>계약 대기(ASSIGNED)</b>로 들어오며, 목록에서 계약서를 작성·발송하세요.
              </p>
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

function WorkScheduleModal({ worker, assignmentId, initial, onClose, onSaved }: {
  worker: Worker; assignmentId: string; initial: Assignment;
  onClose: () => void; onSaved: (updated: Assignment) => void;
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

  const isFullDay = workType === "FULL_DAY";

  // 계약서 파생 필드(근무형태·근로계약 기간·출퇴근 지도 포함 여부) 강제 변경 시 1회 경고.
  // 이 값들은 근로계약서 내용에서 자동 셋팅되므로, 변경하면 신규 계약서 작성이 필요함을 알린다.
  // 계약파생 필드별로 1회씩 경고(근무형태·근로계약 기간·출퇴근 지도 — 각각 동일하게).
  const [warnedFields, setWarnedFields] = useState<Set<string>>(new Set());
  function warnContractChange(field: "workType" | "period" | "commute") {
    // 연결된 계약서가 있을 때만 경고(신규 배정 최초 설정 시엔 경고 불필요)
    if (!initial.hasContract || warnedFields.has(field)) return;
    alert("해당 내용 변경 시 근로계약서 내용이 변경되어 신규 근로계약서 작성이 필요합니다.");
    setWarnedFields(prev => new Set(prev).add(field));
  }

  // 근무형태 변경 시 기본 시간으로 초기화 (이미 커스텀 값이 있으면 유지)
  function changeWorkType(wt: WorkType) {
    if (wt !== workType) warnContractChange("workType");
    setWorkType(wt);
    const def = WORK_TYPE_DEFAULTS[wt];
    setWorkStart(def.start);
    setWorkEnd(def.end);
  }

  async function handleSave() {
    if (!wantField && !wantAdapt) { setError("현장 구분을 1개 이상 선택하세요."); return; }
    if (!cStart || !cEnd) { setError("근로계약 시작일과 종료일을 모두 입력하세요."); return; }
    if (cEnd < cStart) { setError("종료일은 시작일 이후여야 합니다."); return; }
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

        {/* 계약(배정) 기간 — 수동 입력. 직무지도원 계약은 반드시 종료일 존재 */}
        <div>
          <label className={T.label}>근로계약 기간</label>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={cStart} max={cEnd || undefined} onChange={e => { warnContractChange("period"); setCStart(e.target.value); }} className={`w-40 ${T.input}`} />
            <span className="font-semibold text-slate-400">~</span>
            <input type="date" value={cEnd} min={cStart || undefined} onChange={e => { warnContractChange("period"); setCEnd(e.target.value); }} className={`w-40 ${T.input}`} />
            <span className="ml-1 text-xs font-semibold text-slate-400">해당 근로계약 기간은 근로계약서 기반으로 자동 입력됩니다.</span>
          </div>
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
                  onChange={e => { warnContractChange("commute"); setCommuteGuidanceIncluded(e.target.checked); }}
                  className="h-4 w-4 flex-shrink-0 accent-slate-950" />
                <span className="text-sm font-black text-slate-900">출퇴근 지도 포함 (+60분) <span className="font-semibold text-slate-400">출근 30분 + 퇴근 30분</span></span>
              </label>
              <p className="flex items-center text-xs font-bold text-rose-600">
                ※ 휴게시간 지도(30분)는 4시간 근무 시 무조건 포함됩니다.
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

        {/* 출퇴근 버튼 미적용 여부(시프티 병행) — 운영자 전용. 매니저는 현재 상태만 확인 */}
        <div>
          <label className={T.label}>출퇴근 버튼 미적용 여부</label>
          <div className={`flex items-center gap-3 rounded-xl border p-3 ${
            attendanceButtonExempt ? "border-rose-200 bg-rose-50" : "border-sky-200 bg-sky-50"
          }`}>
            <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-black ${
              attendanceButtonExempt ? "bg-rose-100 text-rose-700" : "bg-sky-100 text-sky-700"
            }`}>
              {attendanceButtonExempt ? "미적용 중" : "적용 중"}
            </span>
            <div>
              <span className="text-sm font-black text-slate-900">출퇴근 버튼 없이 자동 출근부 작성</span>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">
                직무지도원이 출퇴근 버튼으로 직접 출퇴근 시간을 기록합니다. 해당 적용 여부 변경은 시스템 운영자만 가능합니다.
              </p>
            </div>
          </div>
        </div>
        </div>

        {error && <p className="mb-3 mt-5 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-7 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { window.location.href = `/manager/contracts?assignmentId=${assignmentId}&workerId=${worker.id}`; }}
            className={`rounded-xl border px-3.5 py-2.5 text-sm font-bold transition ${
              initial.hasContract
                ? "border-slate-200 text-slate-600 hover:bg-slate-50"
                : "border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
            }`}
          >
            {initial.hasContract ? "계약서 재작성·발송" : "계약서 작성·발송"}
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className={T.btnSecondary}>취소</button>
            <button onClick={handleSave} disabled={saving} className={T.btnPrimary}>
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // 딥링크: ?q=대상 으로 진입 시 검색 시드(대시보드 운영 리스크 항목 클릭)
  useEffect(() => {
    const sq = new URLSearchParams(window.location.search).get("q");
    if (sq) setQuery(sq);
  }, []);
  const [editTarget,     setEditTarget]     = useState<{ worker: Worker; assignment: Assignment } | null>(null);
  const [showInvite,     setShowInvite]     = useState(false);
  const [assignmentMap, setAssignmentMap] = useState<Record<string, Assignment>>({});

  useEffect(() => {
    fetch("/api/admin/workers")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) { setWorkers(d.data); setTotal(d.total ?? d.data.length); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workers
      .filter(c => statusFilter.length === 0 || statusFilter.includes(c.status))
      .filter(c => !q ||
        c.workerName.toLowerCase().includes(q) || c.phoneNumber.includes(q) ||
        (c.activeAssignment?.siteName ?? "").toLowerCase().includes(q) || c.loginId.toLowerCase().includes(q));
  }, [workers, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, statusFilter]);

  const activeCnt   = workers.filter(c => c.status === "ACTIVE").length;
  const pausedCnt   = workers.filter(c => c.status === "PAUSED").length;
  const resignedCnt = workers.filter(c => c.status === "RESIGNED").length;
  const filters: FilterChip[] = [
    { value: "ACTIVE", label: "활성", count: activeCnt },
    { value: "PAUSED", label: "일시정지", count: pausedCnt },
    { value: "RESIGNED", label: "퇴사", count: resignedCnt },
  ];
  const toggleStatus = (v: string) => setStatusFilter(p => p.includes(v) ? p.filter(x => x !== v) : [...p, v]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="직무지도원 배정 관리"
        sub="직무지도원과 현장(사업체)의 배정 현황을 관리합니다. 목록에서 직무지도원을 선택하면 근무형태·서비스 단계·근로계약 기간 등 배정 정보를 설정할 수 있습니다."
        actions={
          <button onClick={() => setShowInvite(true)} className={`${T.btnPrimary} flex items-center gap-1.5`}>
            <Send className="h-3.5 w-3.5" />초대 발송
          </button>
        }
      />

      <StatCardRow
        cols={4}
        items={[
          { label: "전체", value: workers.length },
          { label: "활성", value: activeCnt, tone: "emerald" },
          { label: "일시정지", value: pausedCnt, tone: "amber" },
          { label: "퇴사", value: resignedCnt, tone: "slate" },
        ]}
      />

      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="이름 / 전화번호 / 현장(사업체) / 아이디 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["직무지도원 성명(아이디)", "전화번호", "현장(사업체)", "현장 구분", "기관", "근무형태", "배정일", "플랜", "상태"].map(h => (
                <th key={h} className={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className={T.tdCenter}>{workers.length === 0 ? "직무지도원이 없습니다." : "조건에 맞는 직무지도원이 없습니다."}</td></tr>
            ) : pageItems.map(c => {
              const assignmentId = c.activeAssignment?.assignmentId;
              const cachedAsgn = assignmentId ? assignmentMap[assignmentId] : null;
              // 근무형태는 목록 API(activeAssignment.workType)에서 항상 표기.
              // 저장 후엔 캐시(cachedAsgn)가 우선 — 행 열람/취소만으로는 표기가 바뀌지 않음.
              const wt = (cachedAsgn?.workType ?? c.activeAssignment?.workType) as WorkType | undefined;
              const workTypeLabel = wt ? WORK_TYPE_LABELS[wt] : (c.activeAssignment ? "미설정" : "-");
              // 현장 구분: 전환일 있으면 복합(2단계), 없으면 단건
              const adaptStart = cachedAsgn?.adaptationStartDate ?? c.activeAssignment?.adaptationStartDate ?? null;
              const step = (cachedAsgn?.serviceStep ?? c.activeAssignment?.serviceStep) as ServiceStep | undefined;
              return (
                <tr key={c.id}
                  className={`${T.trBase} ${c.activeAssignment ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  onClick={() => c.activeAssignment && openEdit(c)}>
                  <td className={`${T.td} whitespace-nowrap`}><span className="font-semibold text-sky-600">{workerLabel(c.workerName, c.loginId)}</span></td>
                  <td className={T.td}>{c.phoneNumber}</td>
                  <td className={T.td}>
                    <div className="max-w-[150px] truncate">
                      {c.activeAssignment?.siteName
                        ? c.activeAssignment.siteName
                        : <span className="text-slate-400">미배정</span>}
                    </div>
                    {c.activeAssignment?.assignStatus && ASSIGN_STATUS_BADGE[c.activeAssignment.assignStatus] && (
                      <span className={`${T.badge} mt-1 inline-block ${ASSIGN_STATUS_BADGE[c.activeAssignment.assignStatus].cls}`}>
                        {ASSIGN_STATUS_BADGE[c.activeAssignment.assignStatus].label}
                      </span>
                    )}
                  </td>
                  <td className={T.td}>
                    {!c.activeAssignment ? "-"
                      : adaptStart
                        ? <span className={`${T.badge} bg-violet-50 text-violet-600`}>복합 2단계</span>
                        : <span className="text-slate-700">{step === "ADAPTATION" ? "적응지도" : "지원고용 훈련"}</span>}
                  </td>
                  <td className={T.td}><div className="max-w-[120px] truncate">{c.activeAssignment?.agencyName || "-"}</div></td>
                  <td className={T.td}>
                    {c.activeAssignment
                      ? <span className="text-slate-700">{workTypeLabel}</span>
                      : "-"}
                  </td>
                  <td className={T.td}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td className={T.td}>
                    {c.planType && c.planType !== "FREE"
                      ? <StatusBadge status={c.planType === "PREMIUM" ? "PRO" : c.planType} map={PLAN_BADGE} />
                      : <span className="text-[13px] text-slate-300">무료</span>}
                  </td>
                  <td className={T.td}>
                    <StatusBadge status={c.status} map={STATUS_BADGE} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination className="border-t border-slate-100 px-4 py-3" page={page} totalPages={totalPages} total={filtered.length} onPageChange={setPage} />
      </div>

      {editTarget && (
        <WorkScheduleModal
          worker={editTarget.worker}
          assignmentId={editTarget.assignment.id}
          initial={editTarget.assignment}
          onClose={() => setEditTarget(null)}
          onSaved={updated => setAssignmentMap(prev => ({ ...prev, [updated.id]: updated }))}
        />
      )}

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}
