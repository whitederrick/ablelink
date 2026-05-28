"use client";

import { useEffect, useState } from "react";
import { T } from "../_styles";
import { CheckCircle2, Copy, Pencil, Send } from "lucide-react";

type WorkType = "AM" | "PM" | "FULL_DAY" | "CUSTOM";

interface Assignment {
  id: string;
  workType: WorkType;
  commuteGuidanceIncluded: boolean;
  customWorkStart: string | null;
  customWorkEnd: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface Coach {
  id: string;
  userName: string;
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

const STATUS_CLS: Record<string, { label: string; cls: string }> = {
  ACTIVE:   { label: "활성",    cls: "bg-emerald-50 text-emerald-600" },
  RESIGNED: { label: "퇴사",    cls: "bg-slate-100 text-slate-500" },
  PAUSED:   { label: "일시정지", cls: "bg-amber-50 text-amber-600" },
};
const PLAN_CLS: Record<string, { label: string; cls: string }> = {
  FREE:    { label: "무료",    cls: "bg-slate-100 text-slate-500" },
  PREMIUM: { label: "프리미엄", cls: "bg-violet-50 text-violet-600" },
};
const WORK_TYPE_LABELS: Record<WorkType, string> = {
  AM:       "오전 (09:00~12:00)",
  PM:       "오후 (13:00~17:00)",
  FULL_DAY: "전일 (09:00~18:00)",
  CUSTOM:   "직접 입력",
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
    fetch("/api/admin/sites?limit=200")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) setSites(d.data); })
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

function WorkScheduleModal({ coach, assignmentId, initial, onClose, onSaved }: {
  coach: Coach; assignmentId: string; initial: Assignment;
  onClose: () => void; onSaved: (updated: Assignment) => void;
}) {
  const [workType, setWorkType] = useState<WorkType>(initial.workType ?? "FULL_DAY");
  const [commuteGuidanceIncluded, setCommuteGuidanceIncluded] = useState(initial.commuteGuidanceIncluded ?? true);
  const [customStart, setCustomStart] = useState(initial.customWorkStart ?? "09:00");
  const [customEnd, setCustomEnd] = useState(initial.customWorkEnd ?? "18:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isFullDay = workType === "FULL_DAY";

  async function handleSave() {
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workType,
          commuteGuidanceIncluded: isFullDay ? false : commuteGuidanceIncluded,
          customWorkStart: workType === "CUSTOM" ? customStart : null,
          customWorkEnd:   workType === "CUSTOM" ? customEnd   : null,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      onSaved({
        ...initial, workType,
        commuteGuidanceIncluded: isFullDay ? false : commuteGuidanceIncluded,
        customWorkStart: workType === "CUSTOM" ? customStart : null,
        customWorkEnd:   workType === "CUSTOM" ? customEnd   : null,
      });
      onClose();
    } catch (e: any) {
      setError(e.message || "저장에 실패했습니다.");
    } finally { setSaving(false); }
  }

  return (
    <div className={T.modalOverlay}>
      <div className={T.modalContent}>
        <h2 className="mb-1 text-base font-black text-slate-900">근무형태 설정</h2>
        <p className="mb-5 text-sm font-semibold text-slate-400">{coach.userName} · {coach.activeAssignment?.siteName}</p>

        <div className="mb-4">
          <label className={T.label}>근무형태</label>
          <div className="grid grid-cols-2 gap-2">
            {(["AM", "PM", "FULL_DAY", "CUSTOM"] as WorkType[]).map(wt => (
              <button key={wt} type="button" onClick={() => setWorkType(wt)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition active:scale-95 ${
                  workType === wt ? "border-slate-950 bg-slate-950 font-black text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}>
                {WORK_TYPE_LABELS[wt]}
              </button>
            ))}
          </div>
        </div>

        {workType === "CUSTOM" && (
          <div className="mb-4">
            <label className={T.label}>근무 시간</label>
            <div className="flex items-center gap-2">
              <input type="time" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className={`flex-1 ${T.input}`} />
              <span className="text-slate-400">~</span>
              <input type="time" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className={`flex-1 ${T.input}`} />
            </div>
          </div>
        )}

        <div className="mb-5">
          <label className={T.label}>출퇴근 지도 포함</label>
          {isFullDay ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-600">
              전일 8시간 근무는 법적 한도로 출퇴근 지도를 포함할 수 없습니다.
            </div>
          ) : (
            <>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <input type="checkbox" checked={commuteGuidanceIncluded}
                  onChange={e => setCommuteGuidanceIncluded(e.target.checked)}
                  className="h-4 w-4 accent-slate-950" />
                <div>
                  <span className="text-sm font-black text-slate-900">출퇴근 지도 포함 (+60분)</span>
                  <p className="mt-0.5 text-xs font-semibold text-slate-400">출근 30분 + 퇴근 30분 · 기본값: 포함</p>
                </div>
              </label>
              {(workType === "AM" || workType === "PM") && (
                <div className="mt-2 rounded-xl border border-sky-200 bg-sky-50 p-2.5 text-xs font-semibold text-sky-700">
                  휴게시간 지도(30분)는 4시간 근무 시 항상 포함됩니다.
                </div>
              )}
            </>
          )}
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

// ── 직무지도원 정보 수정 모달 ─────────────────────────────
function CoachInfoModal({ coach, onClose, onSaved }: {
  coach: Coach; onClose: () => void; onSaved: (updated: Partial<Coach>) => void;
}) {
  const [userName,    setUserName]    = useState(coach.userName);
  const [phoneNumber, setPhoneNumber] = useState(coach.phoneNumber);
  const [resetPw,     setResetPw]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");
  const [tempPw,      setTempPw]      = useState<string | null>(null);

  async function handleSave() {
    setSaving(true); setError("");
    try {
      const res = await fetch(`/api/admin/coaches/${coach.id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          userName:      userName.trim() !== coach.userName ? userName.trim() : undefined,
          phoneNumber:   phoneNumber !== coach.phoneNumber   ? phoneNumber    : undefined,
          resetPassword: resetPw,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      if (data.tempPassword) { setTempPw(data.tempPassword); return; }
      onSaved({ userName: userName.trim(), phoneNumber });
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
            <p className="text-xs font-semibold text-amber-600 mb-1">{coach.userName}님의 임시 비밀번호</p>
            <p className="text-2xl font-black tracking-widest text-amber-900">{tempPw}</p>
          </div>
          <p className="mb-4 text-xs font-semibold text-slate-500">직무지도원에게 임시 비밀번호를 안내해주세요. 로그인 후 변경 요청됩니다.</p>
          <button onClick={() => { onSaved({ userName: userName.trim(), phoneNumber }); onClose(); }}
            className={T.btnPrimary}>확인</button>
        </div>
      </div>
    );
  }

  return (
    <div className={T.modalOverlay}>
      <div className={T.modalContent}>
        <h2 className="mb-1 text-base font-black text-slate-900">직무지도원 정보 수정</h2>
        <p className="mb-5 text-sm font-semibold text-slate-400">{coach.userName}</p>

        <div className="mb-4">
          <label className={T.label}>이름</label>
          <input value={userName} onChange={e => setUserName(e.target.value)} className={T.input} />
        </div>

        <div className="mb-4">
          <label className={T.label}>전화번호</label>
          <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
            placeholder="010-0000-0000" type="tel" className={T.input} />
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

export default function CoachesPage() {
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [editTarget,     setEditTarget]     = useState<{ coach: Coach; assignment: Assignment } | null>(null);
  const [infoEditTarget, setInfoEditTarget] = useState<Coach | null>(null);
  const [showInvite,     setShowInvite]     = useState(false);
  const [assignmentMap, setAssignmentMap] = useState<Record<string, Assignment>>({});

  useEffect(() => {
    fetch("/api/admin/coaches")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) { setCoaches(d.data); setTotal(d.total ?? d.data.length); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function openEdit(coach: Coach) {
    const assignmentId = coach.activeAssignment?.assignmentId;
    if (!assignmentId) return alert("배정된 현장이 없습니다.");
    if (!assignmentMap[assignmentId]) {
      try {
        const res = await fetch(`/api/admin/assignments?userId=${coach.id}`);
        const data = await res.json();
        if (data.success && data.items?.length > 0) {
          const item = data.items.find((i: any) => i.id === assignmentId) ?? data.items[0];
          const asgn: Assignment = {
            id: item.id, workType: (item.workType as WorkType) ?? "FULL_DAY",
            commuteGuidanceIncluded: item.commuteGuidanceIncluded ?? true,
            customWorkStart: item.customWorkStart ?? null, customWorkEnd: item.customWorkEnd ?? null,
            startDate: item.startDate ?? null, endDate: item.endDate ?? null,
          };
          setAssignmentMap(prev => ({ ...prev, [assignmentId]: asgn }));
          setEditTarget({ coach, assignment: asgn });
        }
      } catch { alert("배정 정보 조회에 실패했습니다."); }
    } else {
      setEditTarget({ coach, assignment: assignmentMap[assignmentId] });
    }
  }

  const filtered = coaches.filter(c =>
    c.userName.includes(search) || c.phoneNumber.includes(search) ||
    c.activeAssignment?.siteName.includes(search) || c.loginId.includes(search)
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className={T.pageTitle}>직무지도원 관리</h1>
          <p className={T.pageSub}>총 {total}명 · 행 클릭 시 근무형태 설정</p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className={`${T.btnPrimary} flex items-center gap-1.5`}
        >
          <Send className="h-3.5 w-3.5" />
          초대 발송
        </button>
      </div>

      <div className="flex gap-2">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="이름 / 전화번호 / 현장명 / 아이디 검색"
          className={`flex-1 ${T.input}`} />
      </div>

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
              <tr><td colSpan={9} className={T.tdCenter}>직무지도원이 없습니다.</td></tr>
            ) : filtered.map(c => {
              const status = STATUS_CLS[c.status] || { label: c.status, cls: "bg-slate-100 text-slate-500" };
              const plan = PLAN_CLS[c.planType] || { label: c.planType, cls: "bg-slate-100 text-slate-500" };
              const assignmentId = c.activeAssignment?.assignmentId;
              const cachedAsgn = assignmentId ? assignmentMap[assignmentId] : null;
              const workTypeLabel = cachedAsgn ? WORK_TYPE_LABELS[cachedAsgn.workType] : (c.activeAssignment ? "미설정" : "-");
              return (
                <tr key={c.id}
                  className={`${T.trBase} ${c.activeAssignment ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  onClick={() => c.activeAssignment && openEdit(c)}>
                  <td className={T.td}><span className="font-black text-slate-900">{c.userName}</span></td>
                  <td className={`${T.td} text-slate-500`}>{c.phoneNumber}</td>
                  <td className={`${T.td} text-xs text-slate-400`}>{maskLoginId(c.loginId)}</td>
                  <td className={T.td}>
                    {c.activeAssignment?.siteName
                      ? <span className="text-slate-700">{c.activeAssignment.siteName}</span>
                      : <span className="italic text-slate-300">미배정</span>}
                  </td>
                  <td className={`${T.td} text-slate-500`}>{c.activeAssignment?.agencyName || "-"}</td>
                  <td className={T.td}>
                    {c.activeAssignment ? (
                      <span className={`text-xs ${cachedAsgn ? "font-black text-sky-600" : "text-slate-400"}`}>
                        {workTypeLabel}
                      </span>
                    ) : <span className="text-slate-300">-</span>}
                  </td>
                  <td className={`${T.td} text-xs text-slate-400`}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${plan.cls}`}>{plan.label}</span>
                  </td>
                  <td className={T.td}>
                    <span className={`${T.badge} ${status.cls}`}>{status.label}</span>
                  </td>
                  <td className={T.td} onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setInfoEditTarget(c)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <Pencil className="h-3 w-3" />
                      수정
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <WorkScheduleModal
          coach={editTarget.coach}
          assignmentId={editTarget.assignment.id}
          initial={editTarget.assignment}
          onClose={() => setEditTarget(null)}
          onSaved={updated => setAssignmentMap(prev => ({ ...prev, [updated.id]: updated }))}
        />
      )}

      {infoEditTarget && (
        <CoachInfoModal
          coach={infoEditTarget}
          onClose={() => setInfoEditTarget(null)}
          onSaved={updated => {
            setCoaches(prev => prev.map(c =>
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
