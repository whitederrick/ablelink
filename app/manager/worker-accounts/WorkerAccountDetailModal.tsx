"use client";

// 직무지도원 관리 상세 — 목록 행 클릭 시 뜨는 모달(현장 관리 모달과 동일 구성·사이즈).
// 인적 정보·급여계좌 수정 + 현재/과거 계약(배정) 이력 + 만족도 평가 결과 조회.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { T } from "../_styles";
import { workerLabel } from "../_format";

type Account = {
  id: string; loginId: string; workerName: string; phoneNumber: string;
  status: string; createdAt: string;
  bankName: string | null; accountNumber: string | null; accountHolder: string | null;
  hasPassbook: boolean; passbookUrl: string | null;
};
type AssignmentRow = {
  id: string; siteName: string; status: string;
  startDate: string; endDate: string | null;
  workType: string | null; serviceStep: string; active: boolean;
};
type SurveyRow = {
  id: string; siteName: string | null; status: string; respondedAt: string | null;
  createdAt: string; sharedWithAgency: boolean; overallScore: number | null; comment: string | null;
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

function fmtDate(iso: string) { return iso.slice(0, 10); }
function fmtPeriod(start: string, end: string | null) {
  return `${fmtDate(start)} ~ ${end ? fmtDate(end) : "무기한"}`;
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
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [resetPw, setResetPw] = useState(false);
  const [tempPw, setTempPw] = useState<string | null>(null);

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
            <div className="grid gap-4 lg:grid-cols-2">
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
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-black text-slate-900">급여 계좌</h3>
                    {acc?.hasPassbook && acc.passbookUrl
                      ? <a href={acc.passbookUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100">통장사본 보기</a>
                      : <span className="text-[11px] font-semibold text-slate-400">통장사본 미등록</span>}
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={T.label}>은행명</label><input value={bankName} onChange={e => setBankName(e.target.value)} placeholder="은행명" className={`w-full ${T.input}`} /></div>
                      <div><label className={T.label}>예금주</label><input value={accountHolder} onChange={e => setAccountHolder(e.target.value)} placeholder="예금주" className={`w-full ${T.input}`} /></div>
                    </div>
                    <div><label className={T.label}>계좌번호</label><input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="계좌번호" className={`w-full ${T.input}`} /></div>
                  </div>
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

              {/* 우: 계약 이력 + 평가 */}
              <div className="space-y-4">
                {/* 현재 계약 */}
                <div className={T.card}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">현재 계약</h3>
                  {current.length === 0 ? (
                    <p className="py-2 text-sm font-semibold text-slate-300">진행 중인 계약이 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {current.map(a => (
                        <div key={a.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-black text-slate-900">{a.siteName}</span>
                            <span className={`${T.badge} bg-sky-50 text-sky-600`}>진행 중</span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-slate-500">
                            {fmtPeriod(a.startDate, a.endDate)}
                            {a.workType ? ` · ${WORK_TYPE_LABEL[a.workType] ?? a.workType}` : ""}
                            {` · ${SERVICE_STEP_LABEL[a.serviceStep] ?? a.serviceStep}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 과거 계약 이력 */}
                <div className={T.card}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">과거 계약 이력</h3>
                  {past.length === 0 ? (
                    <p className="py-2 text-sm font-semibold text-slate-300">과거 계약 이력이 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {past.map(a => (
                        <div key={a.id} className="flex items-center justify-between gap-2 border-b border-slate-50 py-2 last:border-b-0">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">{a.siteName}</p>
                            <p className="text-xs font-semibold text-slate-400">{fmtPeriod(a.startDate, a.endDate)}</p>
                          </div>
                          <span className={`${T.badge} bg-slate-100 text-slate-500`}>종료</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 평가 결과 */}
                <div className={T.card}>
                  <h3 className="mb-3 text-sm font-black text-slate-900">만족도 평가 결과</h3>
                  {detail.surveys.length === 0 ? (
                    <p className="py-2 text-sm font-semibold text-slate-300">평가 이력이 없습니다.</p>
                  ) : (
                    <div className="space-y-2">
                      {detail.surveys.map(s => {
                        const st = SURVEY_STATUS_LABEL[s.status] ?? { label: s.status, cls: "bg-slate-100 text-slate-500" };
                        return (
                          <div key={s.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-bold text-slate-700">{s.siteName || "현장 미지정"}</span>
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                {s.overallScore != null && (
                                  <span className="text-sm font-black text-amber-500">★ {s.overallScore.toFixed(1)}</span>
                                )}
                                <span className={`${T.badge} ${st.cls}`}>{st.label}</span>
                              </div>
                            </div>
                            {s.status === "RESPONDED" && s.overallScore == null && (
                              <p className="mt-1 text-xs font-semibold text-slate-400">운영자 전달 후 결과가 표시됩니다.</p>
                            )}
                            {s.comment && <p className="mt-1 whitespace-pre-line text-xs font-semibold text-slate-500">{s.comment}</p>}
                          </div>
                        );
                      })}
                    </div>
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
    </div>
  );
}
