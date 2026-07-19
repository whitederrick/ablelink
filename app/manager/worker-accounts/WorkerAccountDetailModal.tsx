"use client";

// 직무지도원 관리 상세 — 목록 행 클릭 시 뜨는 모달(현장 관리 모달과 동일 구성·사이즈).
// 인적 정보·급여계좌 수정 + 현재/과거 계약(배정) 이력 + 만족도 평가 결과 조회.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";
import { workerLabel } from "../_format";
import BirthDateSelect from "../_components/BirthDateSelect";

type Account = {
  id: string; loginId: string; workerName: string; phoneNumber: string;
  birthDate: string | null;
  status: string; createdAt: string;
  bankName: string | null; accountNumber: string | null; accountHolder: string | null;
  accountVerifiedAt: string | null; accountHolderVerified: boolean | null;
  identityVerifiedAt: string | null; identityMethod: string | null;
};
type AssignmentRow = {
  id: string; siteName: string; status: string;
  startDate: string; endDate: string | null;
  workType: string | null; serviceStep: string; active: boolean;
};
type CategoryScore = { name: string; weight: number; score: number };
type SurveyRow = {
  id: string; siteName: string | null; status: string; respondedAt: string | null;
  createdAt: string; sharedWithAgency: boolean; overallScore: number | null; comment: string | null;
  scores: Record<string, number> | null;
  isRubric?: boolean; totalScore?: number | null; categoryScores?: CategoryScore[] | null;
};
type Detail = { account: Account; assignments: AssignmentRow[]; surveys: SurveyRow[] };

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  ACTIVE:   { label: "활성",     cls: "bg-emerald-50 text-emerald-600" },
  PAUSED:   { label: "일시정지", cls: "bg-amber-50 text-amber-600" },
  RESIGNED: { label: "퇴사",     cls: "bg-slate-100 text-slate-500" },
};
const WORK_TYPE_LABEL: Record<string, string> = {
  AM: "오전", PM: "오후", FULL_DAY: "전일", CUSTOM: "직접",
};
const SERVICE_STEP_LABEL: Record<string, string> = {
  PRE_TRAINING: "사전훈련", FIELD_TRAINING: "지원고용", ADAPTATION: "적응지도",
};
const SURVEY_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING:   { label: "응답 대기", cls: "bg-amber-50 text-amber-600" },
  RESPONDED: { label: "응답 완료", cls: "bg-emerald-50 text-emerald-600" },
  EXPIRED:   { label: "만료",      cls: "bg-slate-100 text-slate-500" },
  CANCELLED: { label: "취소",      cls: "bg-slate-100 text-slate-500" },
};
// 만족도 세부 평가 항목(각 1~5)
const SCORE_LABEL: Record<string, string> = {
  professionalism: "전문성", diligence: "성실성", communication: "소통", support: "지원",
};

function fmtDate(iso: string) { return iso.slice(0, 10); }
function fmtPeriod(start: string, end: string | null) {
  return `${fmtDate(start)} ~ ${end ? fmtDate(end) : "무기한"}`;
}

const PAGE_SIZE = 3; // 과거 계약 이력·평가 결과 한 화면 노출 개수

// 모달 내 경량 페이저 — 페이지가 2개 이상일 때만 표시.
function Pager({ page, pageCount, onChange }: { page: number; pageCount: number; onChange: (p: number) => void }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <button onClick={() => onChange(page - 1)} disabled={page === 0}
        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">이전</button>
      <span className="text-xs font-semibold text-slate-400">{page + 1} / {pageCount}</span>
      <button onClick={() => onChange(page + 1)} disabled={page >= pageCount - 1}
        className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40">다음</button>
    </div>
  );
}

// 만족도 평가 상세 — 목록 항목 클릭 시 뜨는 서브 모달(상위 모달 위에 표시).
function SurveyDetailModal({ survey, onClose }: { survey: SurveyRow; onClose: () => void }) {
  const st = SURVEY_STATUS_LABEL[survey.status] ?? { label: survey.status, cls: "bg-slate-100 text-slate-500" };
  const scoreEntries = survey.scores
    ? Object.entries(survey.scores).filter(([k]) => SCORE_LABEL[k])
    : [];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4"
      onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900">만족도 평가 상세</h3>
            <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
              {survey.siteName || "현장 미지정"}
              {survey.respondedAt ? ` · 응답 ${fmtDate(survey.respondedAt)}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4">
          {(survey.isRubric || survey.totalScore != null) ? (
            // 역량 평가표 결과 — 위탁기관은 '총점 + 카테고리'만 열람(문항·의견은 시스템 관리자 전용)
            survey.totalScore != null ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-semibold text-slate-500">종합 점수</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-sky-600">{survey.totalScore}<span className="text-xs text-slate-400">/100</span></span>
                    <span className={`${T.badge} ${st.cls}`}>{st.label}</span>
                  </div>
                </div>
                {Array.isArray(survey.categoryScores) && survey.categoryScores.length > 0 && (
                  <div className="space-y-1.5">
                    {survey.categoryScores.map((c, i) => (
                      <div key={i} className="rounded-lg border border-slate-100 px-3 py-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-slate-600">{c.name}</span>
                          <span className="text-sm font-black text-slate-800">{c.score}<span className="text-xs font-semibold text-slate-400">/{c.weight}</span></span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${c.weight ? Math.round((c.score / c.weight) * 100) : 0}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs font-semibold text-slate-400">문항별 점수·작성 의견은 비공개입니다(시스템 관리자 보관).</p>
              </>
            ) : (
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm font-semibold text-slate-500">평가 결과</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-400">시스템 관리자 확인</span>
                  <span className={`${T.badge} ${st.cls}`}>{st.label}</span>
                </div>
              </div>
            )
          ) : (
            <>
              {/* 종합 점수·상태(레거시 만족도) */}
              <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="text-sm font-semibold text-slate-500">종합 만족도</span>
                <div className="flex items-center gap-2">
                  {survey.overallScore != null
                    ? <span className="text-lg font-black text-amber-500">★ {survey.overallScore.toFixed(1)}</span>
                    : <span className="text-sm font-semibold text-slate-400">미전달</span>}
                  <span className={`${T.badge} ${st.cls}`}>{st.label}</span>
                </div>
              </div>
              {scoreEntries.length > 0 && (
                <div className="space-y-1.5">
                  {scoreEntries.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                      <span className="text-sm font-semibold text-slate-600">{SCORE_LABEL[k]}</span>
                      <span className="text-sm font-black text-amber-500">★ {Number(v).toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="mb-1 text-xs font-black text-slate-700">코멘트</p>
                {survey.comment
                  ? <p className="whitespace-pre-line rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-600">{survey.comment}</p>
                  : <p className="text-sm font-semibold text-slate-300">작성된 코멘트가 없습니다.</p>}
              </div>
              {survey.status === "RESPONDED" && survey.overallScore == null && (
                <p className="text-xs font-semibold text-slate-400">시스템 관리자 전달 후 점수·코멘트가 표시됩니다.</p>
              )}
            </>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={onClose} className={T.btnSecondary}>닫기</button>
        </div>
      </div>
    </div>
  );
}

export default function WorkerAccountDetailModal({ workerId, onClose, onSaved }: {
  workerId: string; onClose: () => void; onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  // 편집 필드
  const [workerName, setWorkerName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [resetPw, setResetPw] = useState(false);
  const [tempPw, setTempPw] = useState<string | null>(null);

  // 계좌 인증(예금주 조회)
  const [verifying, setVerifying] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 본인 확인(신원)
  const [idVerifying, setIdVerifying] = useState(false);
  const [idMsg, setIdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 과거 계약 이력·평가 결과 페이지(0-base)
  const [pastPage, setPastPage] = useState(0);
  const [surveyPage, setSurveyPage] = useState(0);
  const [surveyDetail, setSurveyDetail] = useState<SurveyRow | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/worker-accounts/${workerId}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok || !data?.success) throw new Error(data?.message || "FAILED");
        if (!alive) return;
        const d: Detail = data.data;
        setDetail(d);
        setWorkerName(d.account.workerName || "");
        setPhoneNumber(d.account.phoneNumber || "");
        setBirthDate(d.account.birthDate || "");
        setBankName(d.account.bankName || "");
        setAccountNumber(d.account.accountNumber || "");
        setAccountHolder(d.account.accountHolder || "");
      } catch {
        if (alive) { alert("상세 조회에 실패했습니다."); onClose(); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId]);

  async function onVerifyAccount() {
    if (!accountNumber.trim()) { setVerifyMsg({ ok: false, text: "계좌번호를 입력해주세요." }); return; }
    setVerifying(true); setVerifyMsg(null);
    try {
      const res = await fetch(`/api/admin/worker-accounts/${workerId}/verify-account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankName, accountNumber, accountHolder }),
      });
      const data = await res.json();
      setVerifyMsg({ ok: !!data.success && data.matched !== false, text: data.message || (data.success ? "인증 완료" : "인증 실패") });
      if (data.success) {
        // 인증 결과 뱃지 갱신
        try {
          const r = await fetch(`/api/admin/worker-accounts/${workerId}`, { cache: "no-store" });
          const d = await r.json();
          if (d?.success) setDetail(d.data);
        } catch { /* noop */ }
      }
    } catch { setVerifyMsg({ ok: false, text: "계좌 인증 중 오류가 발생했습니다." }); }
    finally { setVerifying(false); }
  }

  async function onVerifyIdentityInPerson() {
    if (!confirm("실물 신분증을 직접 확인하셨나요?\n대면 본인 확인 사실이 기록됩니다.")) return;
    setIdVerifying(true); setIdMsg(null);
    try {
      const res = await fetch(`/api/admin/worker-accounts/${workerId}/verify-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "inperson" }),
      });
      const data = await res.json();
      setIdMsg({ ok: !!data.success, text: data.message || (data.success ? "기록되었습니다." : "실패") });
      if (data.success) {
        try {
          const r = await fetch(`/api/admin/worker-accounts/${workerId}`, { cache: "no-store" });
          const d = await r.json();
          if (d?.success) setDetail(d.data);
        } catch { /* noop */ }
      }
    } catch { setIdMsg({ ok: false, text: "처리 중 오류가 발생했습니다." }); }
    finally { setIdVerifying(false); }
  }

  async function onSave() {
    if (!workerName.trim()) return alert("이름을 입력하세요.");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/workers/${workerId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workerName: workerName.trim(),
          phoneNumber: phoneNumber.trim() || undefined,
          birthDate: birthDate || null,
          resetPassword: resetPw,
          bankName, accountNumber, accountHolder,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      if (data.tempPassword) { setTempPw(data.tempPassword); return; } // 임시비번 표시 후 확인 시 닫기
      alert("저장되었습니다.");
      onSaved();
    } catch (e: any) {
      alert(e.message || "저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  const acc = detail?.account;
  const current = detail?.assignments.filter(a => a.active) ?? [];
  const past = detail?.assignments.filter(a => !a.active) ?? [];
  const surveys = detail?.surveys ?? [];

  const pastPageCount = Math.ceil(past.length / PAGE_SIZE);
  const pastSlice = past.slice(pastPage * PAGE_SIZE, pastPage * PAGE_SIZE + PAGE_SIZE);
  const surveyPageCount = Math.ceil(surveys.length / PAGE_SIZE);
  const surveySlice = surveys.slice(surveyPage * PAGE_SIZE, surveyPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div className="w-full max-w-[62rem] max-h-[92vh] overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">직무지도원 상세</h2>
            {acc && (
              <p className="mt-0.5 text-[13px] font-semibold text-slate-400">
                <span className="text-sky-600">{workerLabel(acc.workerName, acc.loginId)}</span>
                {" · "}가입 {fmtDate(acc.createdAt)}
                {" · "}
                <span className={`${T.badge} ${STATUS_LABEL[acc.status]?.cls ?? "bg-slate-100 text-slate-500"}`}>
                  {STATUS_LABEL[acc.status]?.label ?? acc.status}
                </span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-50"><X className="h-5 w-5" /></button>
        </div>

        {/* 임시 비밀번호 발급 결과(인라인) */}
        {tempPw && acc && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-1 text-xs font-semibold text-amber-600">{acc.workerName}님의 임시 비밀번호</p>
            <p className="text-2xl font-black tracking-widest text-amber-900">{tempPw}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">직무지도원에게 안내해주세요. 로그인 후 변경 요청됩니다.</p>
          </div>
        )}

        {loading || !detail ? (
          <div className="flex h-60 items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" /></div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-[40fr_60fr]">
              {/* 좌: 직무지도원 정보(편집) */}
              <div className="space-y-4">
                <div className={T.card}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">직무지도원 정보</h3>
                  <div className="space-y-3">
                    <div>
                      <label className={T.label}>이름 *</label>
                      <input value={workerName} onChange={e => setWorkerName(e.target.value)} className={`w-full ${T.input}`} />
                    </div>
                    <div>
                      <label className={T.label}>전화번호</label>
                      <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} type="tel" placeholder="010-0000-0000" className={`w-full ${T.input}`} />
                    </div>
                    <div>
                      <label className={T.label}>생년월일 <span className="font-semibold text-slate-400">(근로계약서 사용)</span></label>
                      <BirthDateSelect value={birthDate} onChange={setBirthDate} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={T.label}>아이디</label>
                        <input value={acc?.loginId ?? ""} readOnly className={`w-full ${T.input} bg-slate-50`} />
                      </div>
                      <div>
                        <label className={T.label}>가입일</label>
                        <input value={acc ? fmtDate(acc.createdAt) : ""} readOnly className={`w-full ${T.input} bg-slate-50`} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 급여 계좌 */}
                <div className={T.card}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-slate-900">급여 계좌</h3>
                    {acc?.accountVerifiedAt && (
                      acc.accountHolderVerified
                        ? <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>✓ 예금주 확인 {acc.accountVerifiedAt.slice(0, 10)}</span>
                        : <span className={`${T.badge} bg-rose-50 text-rose-600`}>예금주 불일치</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={T.label}>은행명</label><input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="은행명" className={`w-full ${T.input}`} /></div>
                      <div><label className={T.label}>예금주</label><input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} placeholder="예금주" className={`w-full ${T.input}`} /></div>
                    </div>
                    <div><label className={T.label}>계좌번호</label><input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="계좌번호" className={`w-full ${T.input}`} /></div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={onVerifyAccount} disabled={verifying}
                        className={`${T.btnSecondary} disabled:opacity-40`}>
                        {verifying ? "인증 중..." : "계좌 인증"}
                      </button>
                      {verifyMsg && <span className={`text-xs font-semibold ${verifyMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{verifyMsg.text}</span>}
                    </div>
                    <p className="text-[11px] font-semibold text-slate-400">은행·계좌번호로 예금주를 조회해 본인 계좌인지 확인합니다. (직무지도원 조작 불필요)</p>
                  </div>
                </div>

                {/* 본인 확인(신원) */}
                <div className={T.card}>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="text-sm font-black text-slate-900">본인 확인</h3>
                    {acc?.identityVerifiedAt && (
                      <span className={`${T.badge} bg-emerald-50 text-emerald-600`}>
                        ✓ {acc.identityMethod === "INPERSON" ? "대면 확인" : acc.identityMethod === "KAKAO" ? "카카오 인증" : acc.identityMethod === "MOBILE" ? "휴대폰 인증" : "확인"} {acc.identityVerifiedAt.slice(0, 10)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={onVerifyIdentityInPerson} disabled={idVerifying}
                      className={`${T.btnSecondary} disabled:opacity-40`}>
                      {idVerifying ? "처리 중..." : "대면 본인 확인"}
                    </button>
                    {idMsg && <span className={`text-xs font-semibold ${idMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>{idMsg.text}</span>}
                  </div>
                  <p className="mt-2 text-[11px] font-semibold text-slate-400">실물 신분증을 직접 확인한 경우 기록합니다(이미지 미저장). 휴대폰·카카오 본인인증은 추후 제공됩니다.</p>
                </div>

                {/* 임시 비밀번호 발급 */}
                <div className={T.card}>
                  <label className="flex cursor-pointer items-center gap-3">
                    <input type="checkbox" checked={resetPw} onChange={e => setResetPw(e.target.checked)} className="h-4 w-4 accent-slate-950" />
                    <div>
                      <span className="text-sm font-black text-slate-900">임시 비밀번호 발급</span>
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">새 임시 비밀번호를 생성하여 화면에 표시합니다.</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* 우: 계약 이력 + 평가 — 좌측 전체 높이에 맞춰 3개 박스 균등 분배 */}
              <div className="flex h-full flex-col gap-4">
                {/* 현재 계약 */}
                <div className={`${T.card} flex flex-col`}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">현재 계약</h3>
                  {current.length === 0 ? (
                    <p className="py-2 text-sm font-semibold text-slate-300">진행 중인 계약이 없습니다.</p>
                  ) : (
                    <div className="flex-1 space-y-1.5">
                      {current.map(a => (
                        <div key={a.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-1">
                          <span className="truncate font-black text-slate-900">{a.siteName}</span>
                          <span className="flex-shrink-0 text-xs font-semibold text-slate-500">
                            {fmtPeriod(a.startDate, a.endDate)}
                            {a.workType ? ` · ${WORK_TYPE_LABEL[a.workType] ?? a.workType}` : ""}
                            {` · ${SERVICE_STEP_LABEL[a.serviceStep] ?? a.serviceStep}`}
                          </span>
                          <span className={`${T.badge} ml-auto flex-shrink-0 bg-sky-50 text-sky-600`}>진행 중</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 과거 계약 이력 */}
                <div className={`${T.card} flex flex-1 flex-col`}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">과거 계약 이력</h3>
                  {past.length === 0 ? (
                    <p className="py-2 text-sm font-semibold text-slate-300">과거 계약 이력이 없습니다.</p>
                  ) : (
                    <>
                      <div className="flex-1 space-y-1.5">
                        {pastSlice.map(a => (
                          <div key={a.id} className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-1">
                            <span className="truncate font-semibold text-slate-800">{a.siteName}</span>
                            <span className="flex-shrink-0 text-xs font-semibold text-slate-400">{fmtPeriod(a.startDate, a.endDate)}</span>
                            <span className={`${T.badge} ml-auto flex-shrink-0 bg-slate-100 text-slate-500`}>종료</span>
                          </div>
                        ))}
                      </div>
                      <Pager page={pastPage} pageCount={pastPageCount} onChange={setPastPage} />
                    </>
                  )}
                </div>

                {/* 평가 결과 */}
                <div className={`${T.card} flex flex-1 flex-col`}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">만족도 평가 결과</h3>
                  {surveys.length === 0 ? (
                    <p className="py-2 text-sm font-semibold text-slate-300">평가 이력이 없습니다.</p>
                  ) : (
                    <>
                    <div className="flex-1 space-y-1.5">
                      {surveySlice.map(s => {
                        const st = SURVEY_STATUS_LABEL[s.status] ?? { label: s.status, cls: "bg-slate-100 text-slate-500" };
                        return (
                          <button key={s.id} onClick={() => setSurveyDetail(s)}
                            className="flex w-full items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-1 text-left transition hover:bg-slate-100">
                            <span className="truncate text-sm font-bold text-slate-700">{s.siteName || "현장 미지정"}</span>
                            <span className="flex-shrink-0 text-xs font-semibold text-slate-400">{s.respondedAt ? fmtDate(s.respondedAt) : "-"}</span>
                            <span className="ml-auto flex flex-shrink-0 items-center gap-1.5">
                              {s.totalScore != null
                                ? <span className="text-sm font-black text-sky-600">{s.totalScore}점</span>
                                : s.overallScore != null
                                  ? <span className="text-sm font-black text-amber-500">★ {s.overallScore.toFixed(1)}</span>
                                  : null}
                              <span className={`${T.badge} ${st.cls}`}>{st.label}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <Pager page={surveyPage} pageCount={surveyPageCount} onChange={setSurveyPage} />
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* 액션 */}
            <div className="mt-5 flex items-center justify-end gap-2">
              {tempPw ? (
                <button onClick={() => onSaved()} className={T.btnPrimary}>확인</button>
              ) : (
                <>
                  <button onClick={onClose} className={T.btnSecondary}>닫기</button>
                  <button onClick={onSave} disabled={saving} className={T.btnPrimary}>{saving ? "저장 중..." : "변경사항 저장"}</button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* 만족도 평가 상세(서브 모달) */}
      {surveyDetail && <SurveyDetailModal survey={surveyDetail} onClose={() => setSurveyDetail(null)} />}
    </div>
  );
}
