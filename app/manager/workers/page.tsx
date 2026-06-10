"use client";

import { useEffect, useState, useMemo } from "react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";
import ListToolbar, { type FilterChip } from "../_components/ListToolbar";
import Pagination from "../_components/Pagination";
import StatusBadge, { type BadgeTone } from "../_components/StatusBadge";
import { StatCardRow } from "../_components/StatCard";
import { CheckCircle2, Copy, Pencil, Send } from "lucide-react";

type WorkType = "AM" | "PM" | "FULL_DAY" | "CUSTOM";
type ServiceStep = "PRE_TRAINING" | "FIELD_TRAINING" | "ADAPTATION";

interface Assignment {
  id: string;
  workType: WorkType;
  serviceStep: ServiceStep;
  commuteGuidanceIncluded: boolean;
  attendanceButtonExempt?: boolean;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  startDate: string | null;
  endDate: string | null;
}

// 서비스 단계(지원고용/적응지도) — 문서 세트와 일지 종류를 결정. 현장은 지원고용→적응지도로 전환될 수 있음.
const SERVICE_STEP_OPTIONS: { value: ServiceStep; label: string; desc: string }[] = [
  { value: "FIELD_TRAINING", label: "지원고용 현장훈련", desc: "훈련일지·훈련생 종합평가" },
  { value: "ADAPTATION",     label: "취업 후 적응지도", desc: "적응지도 일지·종합평가" },
];

interface Worker {
  id: string;
  workerName: string;
  phoneNumber: string;
  loginId: string;
  planType: string;
  status: string;
  createdAt: string;
  activeAssignment: { siteName: string; agencyName: string; startDate: string; assignmentId?: string } | null;
}

function maskLoginId(id: string) {
  if (!id) return "";
  if (id.includes("@")) {
    const [local, domain] = id.split("@");
    if (local.length <= 2) return id;
    return `${local[0]}${"*".repeat(Math.min(local.length - 2, 4))}${local[local.length - 1]}@${domain}`;
  }
  const digits = id.replace(/\D/g, "");
  if (digits.length >= 10)
    return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
  return id;
}

const STATUS_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  ACTIVE:   { label: "활성",    tone: "emerald" },
  RESIGNED: { label: "퇴사",    tone: "slate" },
  PAUSED:   { label: "일시정지", tone: "amber" },
};
const PLAN_BADGE: Record<string, { label: string; tone: BadgeTone }> = {
  FREE:    { label: "무료",    tone: "slate" },
  PREMIUM: { label: "프리미엄", tone: "violet" },
};
const PAGE_SIZE = 10;
const WORK_TYPE_LABELS: Record<WorkType, string> = {
  AM:       "오전 (09:00~13:00)",
  PM:       "오후 (13:00~17:00)",
  FULL_DAY: "전일 (09:00~18:00)",
  CUSTOM:   "직접 입력",
};

// 근무형태별 기본 시작/종료 시간
const WORK_TYPE_DEFAULTS: Record<WorkType, { start: string; end: string }> = {
  AM:       { start: "09:00", end: "13:00" },
  PM:       { start: "13:00", end: "17:00" },
  FULL_DAY: { start: "09:00", end: "18:00" },
  CUSTOM:   { start: "09:00", end: "18:00" },
};

// ── 초대 링크 발송 모달 ───────────────────────────────────
interface Site { id: string; companyName: string; }
interface InviteResult { inviteUrl: string; code: string; phoneNumber: string; expiresAt: string; }

function InviteModal({ onClose }: { onClose: () => void }) {
  const [phone,      setPhone]      = useState("");
  const [workerName, setWorkerName] = useState("");
  const [siteId,     setSiteId]     = useState("");
  const [sites,      setSites]      = useState<Site[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [result,     setResult]     = useState<InviteResult | null>(null);
  const [copied,     setCopied]     = useState(false);

  useEffect(() => {
    fetch("/api/admin/sites?pageSize=100")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.items)) setSites(d.items); })
      .catch(() => {});
  }, []);

  async function handleSend() {
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/admin/workers/invite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phone.replace(/-/g, "").trim(),
          workerName: workerName.trim() || undefined,
          siteId: siteId || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setResult(data.invite);
    } catch { setError("서버와 연결할 수 없습니다."); }
    finally { setLoading(false); }
  }

  async function handleCopy(text: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={T.modalOverlay}>
      <div className={T.modalContent}>
        {!result ? (
          <>
            <h2 className="mb-1 text-base font-black text-slate-900">직무지도원 초대</h2>
            <p className="mb-5 text-sm font-semibold text-slate-400">전화번호로 초대 링크와 인증번호를 문자 발송합니다.</p>

            <div className="mb-4">
              <label className={T.label}>휴대전화번호 <span className="text-rose-500">*</span></label>
              <input
                type="tel" placeholder="01012345678"
                value={phone} onChange={e => { setPhone(e.target.value); setError(""); }}
                className={`w-full ${T.input}`}
              />
            </div>

            <div className="mb-4">
              <label className={T.label}>이름 (선택)</label>
              <input
                type="text" placeholder="홍길동"
                value={workerName} onChange={e => setWorkerName(e.target.value)}
                className={`w-full ${T.input}`}
              />
              <p className="mt-1 text-xs font-semibold text-slate-400">입력 시 가입 화면에 이름이 미리 채워집니다.</p>
            </div>

            <div className="mb-6">
              <label className={T.label}>배정 현장 (선택)</label>
              <select value={siteId} onChange={e => setSiteId(e.target.value)} className={`w-full ${T.select}`}>
                <option value="">현장 미지정</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.companyName}</option>)}
              </select>
            </div>

            {error && (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className={T.btnSecondary}>취소</button>
              <button
                onClick={handleSend}
                disabled={loading || !phone.replace(/-/g, "").match(/^01[0-9]{8,9}$/)}
                className={`${T.btnPrimary} flex items-center gap-1.5`}
              >
                <Send className="h-3.5 w-3.5" />
                {loading ? "발송 중..." : "초대 발송"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-black text-slate-900">초대 발송 완료</p>
                <p className="text-xs font-semibold text-slate-400">{result.phoneNumber.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")} · 24시간 유효</p>
              </div>
            </div>

            <div className="mb-3 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-black text-slate-500">인증번호</p>
                <p className="text-2xl font-black tracking-[8px] text-slate-900">{result.code}</p>
                <p className="mt-1 text-xs font-semibold text-slate-400">직무지도원에게 구두 또는 문자로 전달해주세요.</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-black text-slate-500">초대 링크</p>
                <p className="mb-2 break-all text-xs font-semibold text-sky-600">{result.inviteUrl}</p>
                <button
                  onClick={() => handleCopy(result.inviteUrl)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? "복사됨!" : "링크 복사"}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-700">
                SMS 환경변수(KAKAO_ALIMTALK_*)가 설정된 경우 자동 문자 발송됩니다.
                미설정 시 위 링크와 인증번호를 직접 전달해주세요.
              </p>
            </div>

            <div className="mt-5 flex justify-end">
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
  // 적응지도면 ADAPTATION, 그 외(사전/현장훈련)는 지원고용으로 취급
  const [serviceStep, setServiceStep] = useState<ServiceStep>(initial.serviceStep === "ADAPTATION" ? "ADAPTATION" : "FIELD_TRAINING");
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

  // 근무형태 변경 시 기본 시간으로 초기화 (이미 커스텀 값이 있으면 유지)
  function changeWorkType(wt: WorkType) {
    setWorkType(wt);
    const def = WORK_TYPE_DEFAULTS[wt];
    setWorkStart(def.start);
    setWorkEnd(def.end);
  }

  // 총 시간 계산 (표시용)
  function totalHours() {
    const [sh, sm] = workStart.split(":").map(Number);
    const [eh, em] = workEnd.split(":").map(Number);
    const total = (eh * 60 + em) - (sh * 60 + sm);
    if (total <= 0) return "0H";
    const guidance = isFullDay ? total - 60 : total;  // 전일: 점심 1H 공제
    return isFullDay
      ? `총 ${(total / 60).toFixed(1)}H (점심 1H 공제 → 인정 ${(guidance / 60).toFixed(1)}H)`
      : `${(total / 60).toFixed(1)}H`;
  }

  async function handleSave() {
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workType,
          serviceStep,
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
        ...initial, workType, serviceStep,
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

  return (
    <div className={T.modalOverlay}>
      <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-8 shadow-2xl shadow-slate-950/20">
        <h2 className="mb-1 text-lg font-black text-slate-900">배정 설정</h2>
        <p className="mb-6 text-sm font-semibold text-slate-400">{worker.workerName} · {worker.activeAssignment?.siteName}</p>

        <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        {/* 서비스 단계 선택 (지원고용 ↔ 적응지도) */}
        <div>
          <label className={T.label}>서비스 단계</label>
          <div className="grid grid-cols-2 gap-2">
            {SERVICE_STEP_OPTIONS.map(opt => (
              <button key={opt.value} type="button" onClick={() => setServiceStep(opt.value)}
                className={`rounded-xl border px-3 py-2.5 text-left transition active:scale-95 ${
                  serviceStep === opt.value ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}>
                <span className={`block text-sm ${serviceStep === opt.value ? "font-black" : "font-semibold"}`}>{opt.label}</span>
                <span className={`block text-xs ${serviceStep === opt.value ? "text-slate-300" : "text-slate-400"}`}>{opt.desc}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs font-semibold text-slate-400">현장이 취업 후 적응지도로 전환되면 여기서 변경하세요. 과거 일지는 그대로 보존됩니다.</p>
        </div>

        {/* 근무형태 선택 */}
        <div>
          <label className={T.label}>근무형태</label>
          <div className="grid grid-cols-2 gap-2">
            {(["AM", "PM", "FULL_DAY", "CUSTOM"] as WorkType[]).map(wt => (
              <button key={wt} type="button" onClick={() => changeWorkType(wt)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                  workType === wt ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}>
                {WORK_TYPE_LABELS[wt]}
              </button>
            ))}
          </div>
        </div>

        {/* 계약(배정) 기간 — 수동 입력 */}
        <div>
          <label className={T.label}>근로계약 기간</label>
          <div className="flex items-center gap-2">
            <input type="date" value={cStart} max={cEnd || undefined} onChange={e => setCStart(e.target.value)} className={`flex-1 ${T.input}`} />
            <span className="font-semibold text-slate-400">~</span>
            <input type="date" value={cEnd} min={cStart || undefined} onChange={e => setCEnd(e.target.value)} className={`flex-1 ${T.input}`} />
          </div>
          <p className="mt-1.5 text-xs font-semibold text-slate-400">종료일을 비우면 무기한. 이 기간이 유료기능 접근 판정의 계약기간이 됩니다.</p>
        </div>

        {/* 근무 시간 — 모든 유형에서 수정 가능 */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className={T.label} style={{ marginBottom: 0 }}>근무 시간</label>
            <span className="text-xs font-semibold text-slate-400">{totalHours()}</span>
          </div>
          <div className="flex items-center gap-2">
            <input type="time" value={workStart} onChange={e => setWorkStart(e.target.value)}
              className={`flex-1 ${T.input}`} />
            <span className="text-slate-400 font-semibold">~</span>
            <input type="time" value={workEnd} onChange={e => setWorkEnd(e.target.value)}
              className={`flex-1 ${T.input}`} />
          </div>
          {isFullDay && (
            <p className="mt-1.5 text-xs font-semibold text-slate-400">
              전일 근무: 점심시간 1시간이 자동 공제되어 공단 인정시간에서 제외됩니다.
            </p>
          )}
        </div>

        {/* 출퇴근 지도 */}
        <div className="sm:col-span-2">
          <label className={T.label}>출퇴근 지도 포함</label>
          {isFullDay ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
              전일 근무는 출퇴근 지도를 포함할 수 없습니다.
            </div>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input type="checkbox" checked={commuteGuidanceIncluded}
                  onChange={e => setCommuteGuidanceIncluded(e.target.checked)}
                  className="h-4 w-4 accent-slate-950" />
                <div>
                  <span className="text-sm font-black text-slate-900">출퇴근 지도 포함 (+60분)</span>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">출근 30분 + 퇴근 30분</p>
                </div>
              </label>
              <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-2.5 text-xs font-semibold text-sky-700">
                휴게시간 지도(30분)는 항상 포함됩니다.
              </div>
            </>
          )}
        </div>

        {/* 출퇴근 버튼 면제(시프티 병행) — 운영자 전용. 매니저는 현재 상태만 확인 */}
        <div className="sm:col-span-2">
          <label className={T.label}>출퇴근 버튼 면제</label>
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-black ${
              attendanceButtonExempt ? "bg-sky-100 text-sky-700" : "bg-slate-200 text-slate-500"
            }`}>
              {attendanceButtonExempt ? "면제 적용 중" : "미적용"}
            </span>
            <div>
              <span className="text-sm font-black text-slate-900">출퇴근 버튼 없이 자동 작성 (시프티 병행)</span>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">
                {attendanceButtonExempt
                  ? "근무형태 기준으로 출근부가 매일 자동 생성됩니다."
                  : "직무지도원이 출퇴근 버튼으로 직접 기록합니다."}
                {" "}변경은 시스템 운영자만 가능합니다.
              </p>
            </div>
          </div>
        </div>
        </div>

        {error && <p className="mb-3 mt-5 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="mt-7 flex justify-end gap-2">
          <button onClick={onClose} className={T.btnSecondary}>취소</button>
          <button onClick={handleSave} disabled={saving} className={T.btnPrimary}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 직무지도원 정보 수정 모달 ─────────────────────────────
function WorkerInfoModal({ worker, onClose, onSaved }: {
  worker: Worker; onClose: () => void; onSaved: (updated: Partial<Worker>) => void;
}) {
  const [workerName,    setUserName]    = useState(worker.workerName);
  const [phoneNumber, setPhoneNumber] = useState(worker.phoneNumber);
  const [resetPw,     setResetPw]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [tempPw,      setTempPw]      = useState<string | null>(null);

  // 급여 계좌(셀프 입력 우선, 매니저 보완 가능) + 통장사본 조회
  const [bankName,      setBankName]      = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [passbookUrl,   setPassbookUrl]   = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/workers/${worker.id}`).then(r => r.json()).then(d => {
      if (d.success) {
        setBankName(d.data.bankName ?? "");
        setAccountNumber(d.data.accountNumber ?? "");
        setAccountHolder(d.data.accountHolder ?? "");
        setPassbookUrl(d.data.passbookUrl ?? null);
      }
    }).catch(() => {});
  }, [worker.id]);

  async function handleSave() {
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/workers/${worker.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          workerName:      workerName.trim() !== worker.workerName ? workerName.trim() : undefined,
          phoneNumber:   phoneNumber !== worker.phoneNumber   ? phoneNumber    : undefined,
          resetPassword: resetPw,
          bankName, accountNumber, accountHolder,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      if (data.tempPassword) { setTempPw(data.tempPassword); return; }
      onSaved({ workerName: workerName.trim(), phoneNumber });
      onClose();
    } catch { setError("저장에 실패했습니다."); }
    finally   { setSaving(false); }
  }

  if (tempPw) {
    return (
      <div className={T.modalOverlay}>
        <div className={T.modalContent}>
          <h2 className="mb-3 text-base font-black text-slate-900">임시 비밀번호 발급 완료</h2>
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-600 mb-1">{worker.workerName}님의 임시 비밀번호</p>
            <p className="text-2xl font-black tracking-widest text-amber-900">{tempPw}</p>
          </div>
          <p className="mb-4 text-xs font-semibold text-slate-500">직무지도원에게 임시 비밀번호를 안내해주세요. 로그인 후 변경 요청됩니다.</p>
          <button onClick={() => { onSaved({ workerName: workerName.trim(), phoneNumber }); onClose(); }}
            className={T.btnPrimary}>확인</button>
        </div>
      </div>
    );
  }

  return (
    <div className={T.modalOverlay}>
      <div className={T.modalContent}>
        <h2 className="mb-1 text-base font-black text-slate-900">직무지도원 정보 수정</h2>
        <p className="mb-5 text-sm font-semibold text-slate-400">{worker.workerName}</p>

        <div className="mb-4">
          <label className={T.label}>이름</label>
          <input value={workerName} onChange={e => setUserName(e.target.value)} className={T.input} />
        </div>

        <div className="mb-4">
          <label className={T.label}>전화번호</label>
          <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
            placeholder="010-0000-0000" type="tel" className={T.input} />
        </div>

        {/* 급여 계좌 (직무지도원 셀프 입력 우선, 매니저 보완 가능) */}
        <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className={`${T.label} mb-0`}>급여 계좌</label>
            {passbookUrl
              ? <a href={passbookUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">통장사본 보기</a>
              : <span className="text-[11px] font-semibold text-slate-400">통장사본 미등록</span>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="은행명" className={T.input} />
            <input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} placeholder="예금주" className={T.input} />
          </div>
          <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="계좌번호" className={`w-full ${T.input}`} />
        </div>

        <div className="mb-5">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input type="checkbox" checked={resetPw} onChange={e => setResetPw(e.target.checked)}
              className="h-4 w-4 accent-slate-950" />
            <div>
              <span className="text-sm font-black text-slate-900">임시 비밀번호 발급</span>
              <p className="mt-0.5 text-xs font-semibold text-slate-400">새 임시 비밀번호를 생성하여 화면에 표시합니다.</p>
            </div>
          </label>
        </div>

        {error && <p className="mb-3 text-sm font-semibold text-rose-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={T.btnSecondary}>취소</button>
          <button onClick={handleSave} disabled={saving} className={T.btnPrimary}>
            {saving ? "저장 중..." : "저장"}
          </button>
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
  const [editTarget,     setEditTarget]     = useState<{ worker: Worker; assignment: Assignment } | null>(null);
  const [infoEditTarget, setInfoEditTarget] = useState<Worker | null>(null);
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
            id: item.id, workType: (item.workType as WorkType) ?? "FULL_DAY",
            serviceStep: (item.serviceStep as ServiceStep) ?? "FIELD_TRAINING",
            commuteGuidanceIncluded: item.commuteGuidanceIncluded ?? true,
            attendanceButtonExempt: item.attendanceButtonExempt ?? false,
            customWorkStart: item.customWorkStart ?? null, customWorkEnd: item.customWorkEnd ?? null,
            startDate: item.startDate ?? null, endDate: item.endDate ?? null,
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
        title="직무지도원 관리"
        sub={`총 ${total}명 · 행 클릭 시 근무형태 설정`}
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
        placeholder="이름 / 전화번호 / 현장명 / 아이디 검색"
        filters={filters}
        selected={statusFilter}
        onToggleFilter={toggleStatus}
      />

      <div className={T.tableWrap}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {["이름", "전화번호", "아이디", "현장", "기관", "근무형태", "배정일", "플랜", "상태", ""].map(h => (
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
              const workTypeLabel = cachedAsgn ? WORK_TYPE_LABELS[cachedAsgn.workType] : (c.activeAssignment ? "미설정" : "-");
              return (
                <tr key={c.id}
                  className={`${T.trBase} ${c.activeAssignment ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  onClick={() => c.activeAssignment && openEdit(c)}>
                  <td className={T.td}>{c.workerName}</td>
                  <td className={T.td}>{c.phoneNumber}</td>
                  <td className={T.td}>{maskLoginId(c.loginId)}</td>
                  <td className={T.td}>
                    {c.activeAssignment?.siteName
                      ? c.activeAssignment.siteName
                      : <span className="text-slate-400">미배정</span>}
                  </td>
                  <td className={T.td}>{c.activeAssignment?.agencyName || "-"}</td>
                  <td className={T.td}>
                    {c.activeAssignment
                      ? <span className={cachedAsgn ? "text-sky-600" : "text-slate-400"}>{workTypeLabel}</span>
                      : "-"}
                  </td>
                  <td className={T.td}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td className={T.td}>
                    <StatusBadge status={c.planType} map={PLAN_BADGE} />
                  </td>
                  <td className={T.td}>
                    <StatusBadge status={c.status} map={STATUS_BADGE} />
                  </td>
                  <td className={T.td} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setInfoEditTarget(c)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      수정
                    </button>
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

      {infoEditTarget && (
        <WorkerInfoModal
          worker={infoEditTarget}
          onClose={() => setInfoEditTarget(null)}
          onSaved={updated => {
            setWorkers(prev => prev.map(c =>
              c.id === infoEditTarget.id ? { ...c, ...updated } : c
            ));
            setInfoEditTarget(null);
          }}
        />
      )}

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  );
}
