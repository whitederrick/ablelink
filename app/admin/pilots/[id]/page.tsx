"use client";

// 파일럿 회차 상세 — 단계별 카드로 셋업한다(별도 위저드 없음).
//
// ★4-A가 순서를 강제한다: 사업체 없이 훈련생을 못 만들고, 훈련생 재적 없이 기존 Worker 참여자를
//  못 만들고, 배정 없는 기존 Worker는 초대 발급이 ASSIGNMENT_REQUIRED로 막힌다.
//  그래서 선행 조건이 안 된 카드는 **비활성 + 이유 문구**로 표시하고, 서버가 준 사유(reason/message)를
//  그대로 사람 말로 노출한다. 운영자가 400/409를 반복해서 맞지 않게 하기 위해서다.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageHeader from "../../_components/PageHeader";
import Pagination from "../../_components/Pagination";
import { T } from "../../_styles";
import { PILOT_STATUS, PARTICIPANT_STATUS, WORK_TYPES, SERVICE_STEPS } from "../_constants";

type Participant = {
  id: string; status: string; isNewWorker: boolean;
  workerName: string | null; workerPhone: string | null;
  siteId: string | null; siteName: string | null;
  assignmentStartDate: string; assignmentEndDate: string;
  serviceStep: string; workType: string;
  assignmentId: string | null; acceptedAt: string | null;
  invite: { code: string; expiresAt: string; used: boolean } | null;
  inviteWorkerName: string | null;
  trainees: { id: string; name: string }[];
};

type SessionDetail = {
  id: string; status: string; editable: "ALL" | "DISPLAY_NAME_ONLY" | "NONE";
  startDate: string; endDate: string; managerDisplayName: string | null;
  agencyId: string; agencyName: string;
  activatedAt: string | null; endedAt: string | null; purgedAt: string | null;
};


export default function PilotDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [sites, setSites] = useState<{ id: string; companyName: string }[]>([]);
  const [trainees, setTrainees] = useState<{ id: string; name: string; siteId: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [loadErr, setLoadErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setLoadErr("");
    try {
      const res = await fetch(`/api/admin/pilots/${id}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { setLoadErr(data?.message || "회차를 불러오지 못했습니다."); return; }
      {
        setSession(data.session);
        setParticipants(data.participants ?? []);
        setSites(data.sites ?? []);
        setTrainees((data.trainees ?? []).map((t: { id: string; name: string; siteId: string | null }) => ({
          id: t.id, name: t.name, siteId: t.siteId ?? "",
        })));
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(""), 4000); };

  // ── 선행 조건 ────────────────────────────────────────────────
  const setupOpen = session?.status === "DRAFT" || session?.status === "READY";
  const hasSite = sites.length > 0;
  const hasTrainee = trainees.length > 0;
  const acceptedCount = participants.filter((p) => p.status === "ACCEPTED").length;
  const pendingCount = participants.filter((p) => p.status === "CONFIGURED" || p.status === "INVITED").length;

  const activateBlockReason = useMemo(() => {
    if (session?.status !== "READY") return "참여 대기(READY) 상태에서만 시작할 수 있습니다.";
    if (acceptedCount === 0) return "수락한 참여자가 없습니다. 최소 1명이 초대를 수락해야 합니다.";
    if (pendingCount > 0) return `아직 수락하지 않은 참여자가 ${pendingCount}명 있습니다. 수락을 기다리거나 참여를 취소해주세요.`;
    return null;
  }, [session?.status, acceptedCount, pendingCount]);

  async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const res = await fetch(url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    // ★서버가 준 message를 그대로 노출한다 — reason 코드를 사람 말로 바꾼 문구가 이미 message에 있다.
    if (!data?.success) notify(data?.message || "요청을 처리하지 못했습니다.");
    return { ok: !!data?.success, data };
  }

  // ★되돌릴 수 없는 전이는 확인을 받는다(참여자 취소와 같은 규율 — 이 화면 :642).
  //  회차 취소·종료 버튼은 되돌리기 버튼과 나란히 있어 오클릭 여지가 크다.
  const TERMINAL_CONFIRM: Record<string, string> = {
    CANCELLED: "이 회차를 취소하면 되돌릴 수 없습니다. 계속할까요?",
    ENDED: "파일럿을 종료하면 다시 진행 상태로 되돌릴 수 없습니다. 계속할까요?",
  };

  async function transition(to: string) {
    const ask = TERMINAL_CONFIRM[to];
    if (ask && !window.confirm(ask)) return;
    const res = await fetch(`/api/admin/pilots/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: to }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data?.success) { notify(data?.message || "상태를 바꾸지 못했습니다."); return; }
    notify("상태를 변경했습니다.");
    await load();
  }

  if (loading) return <div className="p-6 text-sm font-semibold text-slate-400">불러오는 중…</div>;
  if (loadErr) {
    return (
      <div className="space-y-3 p-6">
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold text-rose-600">{loadErr}</p>
        <button type="button" onClick={() => void load()} className={T.btnSecondary}>다시 시도</button>
      </div>
    );
  }
  if (!session) return <div className="p-6 text-sm font-semibold text-slate-400">회차를 찾을 수 없습니다.</div>;

  const st = PILOT_STATUS[session.status] ?? { label: session.status, cls: "bg-slate-100 text-slate-600" };

  return (
    <div className="space-y-4 pb-16">
      <PageHeader
        title={<span className="flex items-center gap-2">
          {session.agencyName}
          <span className={`rounded-lg px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
        </span>}
        sub={`${session.startDate} ~ ${session.endDate} · 참여자 ${participants.length}명`}
        actions={<button type="button" onClick={() => router.push("/admin/pilots")} className={T.btnSecondary}>목록</button>}
      />

      {toast && (
        <div className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white">{toast}</div>
      )}

      {/* 1. 회차 설정 */}
      <SessionCard session={session} onSaved={load} notify={notify} />

      {/* 2. 사업체 */}
      <Card
        step={1} title="사업체 등록"
        desc="기존 현장 등록 화면에서 등록합니다(주소 검색·지도·담당자 입력 동일)."
        disabled={!setupOpen}
        disabledReason="설정 중·참여 대기 상태에서만 등록할 수 있습니다."
        always={
          <div>
            <p className="mb-2 text-[13px] font-bold text-slate-600">등록된 사업체 {sites.length}곳</p>
            {hasSite ? (
              <ul className="space-y-1">
                {sites.map((s) => <li key={s.id} className="truncate text-sm font-semibold text-slate-700">· {s.companyName}</li>)}
              </ul>
            ) : (
              <p className="text-sm font-semibold text-slate-400">아직 없습니다.</p>
            )}
          </div>
        }
      >
        {/* ★파일럿용 사업체 폼을 따로 만들지 않는다 — 기존 현장 등록 화면을 그대로 쓴다.
            폼이 두 벌이 되면 한쪽에서 주소검색·추가 담당자 같은 게 빠진다(실제로 그랬다). */}
        <button
          type="button"
          onClick={() => router.push(`/admin/sites/new?pilotSessionId=${id}&returnTo=${encodeURIComponent(`/admin/pilots/${id}`)}`)}
          className={T.btnPrimary}
        >
          사업체 등록 화면 열기
        </button>
        <p className="mt-2 text-[13px] font-semibold text-slate-400">
          기존 현장 등록 화면으로 이동합니다. 위탁기관은 이 회차로 고정되며, 등록 후 이 화면으로 돌아옵니다.
        </p>
      </Card>

      {/* 3. 훈련생 */}
      <Card
        step={2} title="훈련생 등록"
        desc="훈련생을 등록하면 사업체 재적도 함께 만들어집니다(담당 관계의 전제조건)."
        disabled={!setupOpen || !hasSite}
        disabledReason={!setupOpen ? "설정 중·참여 대기 상태에서만 등록할 수 있습니다." : "먼저 사업체를 등록해주세요."}
        always={
          <div>
            <p className="mb-2 text-[13px] font-bold text-slate-600">등록된 훈련생 {trainees.length}명</p>
            {hasTrainee ? (
              <ul className="space-y-1">
                {trainees.map((t) => <li key={t.id} className="truncate text-sm font-semibold text-slate-700">· {t.name}</li>)}
              </ul>
            ) : (
              <p className="text-sm font-semibold text-slate-400">아직 없습니다.</p>
            )}
          </div>
        }
      >
        <TraineeForm sessionId={id} sites={sites} onDone={load} post={post} />
      </Card>

      {/* 4. 참여자 */}
      <Card
        step={3} title="직무지도원 참여자 추가"
        desc="기존 계정이 있으면 선택하고, 없으면 신규로 추가한 뒤 초대를 발급합니다."
        disabled={!setupOpen || !hasTrainee}
        disabledReason={!setupOpen ? "설정 중·참여 대기 상태에서만 추가할 수 있습니다." : "먼저 훈련생을 등록해주세요."}
      >
        <ParticipantForm
          sessionId={id} sites={sites} trainees={trainees}
          period={{ start: session.startDate, end: session.endDate }}
          onDone={load} post={post}
        />
      </Card>

      {/* 5. 참여자 목록 */}
      <ParticipantList
        sessionId={id} participants={participants} setupOpen={setupOpen}
        onChanged={load} notify={notify} post={post}
      />

      {/* 6. 근무일 확인·정정 (§10) */}
      <WorkdayCard
        sessionId={id}
        sessionStatus={session.status}
        assignments={participants
          .filter((p) => p.assignmentId)
          .map((p) => ({
            id: p.assignmentId as string,
            label: `${p.workerName ?? p.inviteWorkerName ?? "직무지도원"} · ${p.siteName ?? "-"}`,
          }))}
        notify={notify}
      />

      {/* 7. 상태 전이 */}
      <Card step={4} title="회차 진행" desc="참여자가 모두 정리되면 파일럿을 시작합니다.">
        <div className="flex flex-wrap gap-2">
          {session.status === "DRAFT" && (
            <button type="button" onClick={() => transition("READY")} className={T.btnPrimary}>
              참여 대기로 전환
            </button>
          )}
          {session.status === "READY" && (
            <>
              <button
                type="button" onClick={() => transition("ACTIVE")}
                disabled={!!activateBlockReason} className={T.btnPrimary}
              >
                파일럿 시작
              </button>
              <button type="button" onClick={() => transition("DRAFT")} className={T.btnSecondary}>
                설정으로 되돌리기
              </button>
            </>
          )}
          {session.status === "ACTIVE" && (
            <button type="button" onClick={() => transition("ENDED")} className={T.btnSecondary}>
              파일럿 종료
            </button>
          )}
          {(session.status === "DRAFT" || session.status === "READY") && (
            <button type="button" onClick={() => transition("CANCELLED")} className={T.btnDanger}>
              회차 취소
            </button>
          )}
        </div>
        {session.status === "READY" && activateBlockReason && (
          <p className="mt-2 text-[13px] font-bold text-amber-700">{activateBlockReason}</p>
        )}
        {session.status === "ENDED" && (
          <p className="mt-2 text-[13px] font-semibold text-slate-500">
            종료된 회차입니다. 데이터 폐기는 별도 폐기 기능에서 진행합니다.
          </p>
        )}
      </Card>
    </div>
  );
}

// ── 근무일 확인·정정 (§10) ────────────────────────────────────────
//
// ★파일럿에는 위탁기관 담당자가 없어 기존 근태 승인 경로가 끝까지 가지 않는다.
//  운영자가 여기서 직접 확인·정정한다. 서버(lib/pilot/workday.ts)가 파일럿 배정만
//  받아들이므로, 이 화면이 운영 근태를 건드릴 방법은 없다.
type Workday = { id: string; assignmentId: string; workDate: string; start: string | null; end: string | null; linkedLogs: number };

const WORKDAY_PAGE_SIZE = 10;

function WorkdayCard({
  sessionId, sessionStatus, assignments, notify,
}: {
  sessionId: string; sessionStatus: string;
  assignments: { id: string; label: string }[];
  notify: (m: string) => void;
}) {
  const [rows, setRows] = useState<Workday[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  // 등록 폼
  const [asgId, setAsgId] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // 인라인 시각 수정
  const [editId, setEditId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  const editable = sessionStatus === "ACTIVE";
  const hasAssignment = assignments.length > 0;

  const load = useCallback(async () => {
    if (!hasAssignment) { setRows([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/pilots/${sessionId}/workdays`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { notify(data?.message || "근무일을 불러오지 못했습니다."); return; }
      setRows(data.workdays ?? []);
    } finally { setLoading(false); }
  }, [sessionId, hasAssignment, notify]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (assignments.length === 1) setAsgId(assignments[0].id); }, [assignments]);

  const label = useMemo(
    () => new Map(assignments.map((a) => [a.id, a.label])),
    [assignments],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / WORKDAY_PAGE_SIZE));
  const pageItems = rows.slice((page - 1) * WORKDAY_PAGE_SIZE, page * WORKDAY_PAGE_SIZE);

  async function add() {
    if (!asgId) { notify("배정을 선택해주세요."); return; }
    if (!date) { notify("날짜를 선택해주세요."); return; }
    setBusy("add");
    try {
      const res = await fetch(`/api/admin/pilots/${sessionId}/workdays`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignmentId: asgId, workDate: date, start: start || null, end: end || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { notify(data?.message || "등록하지 못했습니다."); return; }
      notify("근무일을 등록했습니다.");
      setDate(""); setStart(""); setEnd("");
      await load();
    } finally { setBusy(null); }
  }

  async function saveTime(w: Workday) {
    setBusy(w.id);
    try {
      const res = await fetch(`/api/admin/pilots/${sessionId}/workdays/${w.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ start: editStart, end: editEnd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { notify(data?.message || "정정하지 못했습니다."); return; }
      notify("시각을 정정했습니다.");
      setEditId(null);
      await load();
    } finally { setBusy(null); }
  }

  /**
   * ★일지가 붙은 근무일은 서버가 409로 막는다. 여기서 한 번 더 묻는 이유는
   *  일지가 **함께 사라진다**는 사실을 지우기 전에 보여주기 위해서다(Cascade).
   */
  async function remove(w: Workday) {
    const warn = w.linkedLogs > 0
      ? `${w.workDate} 근무일을 삭제하면 작성된 일지 ${w.linkedLogs}건도 함께 삭제됩니다. 되돌릴 수 없습니다. 계속할까요?`
      : `${w.workDate} 근무일을 삭제할까요?`;
    if (!window.confirm(warn)) return;
    setBusy(w.id);
    try {
      const res = await fetch(
        `/api/admin/pilots/${sessionId}/workdays/${w.id}${w.linkedLogs > 0 ? "?force=1" : ""}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { notify(data?.message || "삭제하지 못했습니다."); return; }
      notify(data.deletedLogs > 0 ? `삭제했습니다. (일지 ${data.deletedLogs}건 동반 삭제)` : "삭제했습니다.");
      await load();
    } finally { setBusy(null); }
  }

  return (
    <Card
      step={5}
      title="근무일 확인·정정"
      desc="파일럿에는 위탁기관 담당자가 없어, 운영자가 근무일을 직접 확인·정정합니다. 미래 날짜는 만들 수 없습니다."
      disabled={!editable || !hasAssignment}
      disabledReason={
        !hasAssignment
          ? "참여자가 초대를 수락해 배정이 만들어지면 근무일을 관리할 수 있습니다."
          : "진행 중(ACTIVE)인 회차에서만 정정할 수 있습니다. 목록은 아래에서 계속 확인할 수 있습니다."
      }
      always={
        <>
          <h3 className="text-sm font-black text-slate-700">등록된 근무일</h3>
          {loading ? (
            <p className="mt-3 text-sm font-semibold text-slate-400">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-slate-400">아직 등록된 근무일이 없습니다.</p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-[110px]" /><col className="w-[200px]" />
                    <col className="w-[150px]" /><col className="w-[90px]" /><col className="w-[150px]" />
                  </colgroup>
                  <thead>
                    <tr>{["날짜", "배정", "근무시각", "일지", "작업"].map((h) => (
                      <th key={h} className={T.th}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {pageItems.map((w) => (
                      <tr key={w.id} className={T.trBase}>
                        <td className={`${T.td} truncate`}>{w.workDate}</td>
                        <td className={`${T.td} truncate`}>{label.get(w.assignmentId) ?? "-"}</td>
                        <td className={`${T.td} truncate`}>
                          {editId === w.id ? (
                            <span className="flex items-center gap-1">
                              <input type="time" value={editStart} onChange={(e) => setEditStart(e.target.value)} className={`h-9 w-[76px] ${T.input} px-1`} />
                              <input type="time" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} className={`h-9 w-[76px] ${T.input} px-1`} />
                            </span>
                          ) : (
                            `${w.start ?? "-"} ~ ${w.end ?? "-"}`
                          )}
                        </td>
                        <td className={`${T.td} truncate`}>
                          {w.linkedLogs > 0
                            ? <span className="font-bold text-amber-700">{w.linkedLogs}건</span>
                            : <span className="text-slate-400">없음</span>}
                        </td>
                        <td className={`${T.td} truncate`}>
                          {!editable ? (
                            <span className="text-slate-400">-</span>
                          ) : editId === w.id ? (
                            <span className="flex gap-1">
                              <button type="button" disabled={busy === w.id} onClick={() => saveTime(w)} className={T.btnPrimary}>저장</button>
                              <button type="button" onClick={() => setEditId(null)} className={T.btnSecondary}>취소</button>
                            </span>
                          ) : (
                            <span className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => { setEditId(w.id); setEditStart(w.start ?? "09:00"); setEditEnd(w.end ?? "18:00"); }}
                                className={T.btnSecondary}
                              >
                                시각 수정
                              </button>
                              <button type="button" disabled={busy === w.id} onClick={() => remove(w)} className={T.btnDanger}>삭제</button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} totalPages={totalPages} total={rows.length} onPageChange={setPage} />
            </>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="배정">
          <select value={asgId} onChange={(e) => setAsgId(e.target.value)} className={`w-[220px] ${T.select}`}>
            <option value="">선택</option>
            {assignments.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
        <Field label="날짜">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`w-[160px] ${T.input}`} />
        </Field>
        <Field label="출근(선택)">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`w-[120px] ${T.input}`} />
        </Field>
        <Field label="퇴근(선택)">
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={`w-[120px] ${T.input}`} />
        </Field>
        <button type="button" disabled={busy === "add"} onClick={add} className={T.btnPrimary}>근무일 등록</button>
      </div>
      <p className="mt-2 text-[13px] font-semibold text-slate-500">
        시각을 비우면 근무형태의 표준 출퇴근 시각으로 등록됩니다.
      </p>
    </Card>
  );
}

// ── 공통 카드 ─────────────────────────────────────────────────────
function Card({
  step, title, desc, disabled, disabledReason, children, always,
}: {
  step?: number; title: string; desc?: string;
  disabled?: boolean; disabledReason?: string;
  /** 입력 폼 — 비활성 상태에서는 숨긴다. */
  children: React.ReactNode;
  /**
   * ★상태와 무관하게 항상 보이는 영역(등록된 목록 등).
   *  예전에는 목록을 children에 넣어, 회차가 ACTIVE가 되면 이미 등록한 사업체·훈련생이
   *  화면에서 통째로 사라졌다. "입력을 막는 것"과 "내용을 감추는 것"은 다르다.
   */
  always?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-black text-slate-900">
            {step != null && <span className="mr-2 text-slate-400">{step}</span>}{title}
          </h2>
          {desc && <p className="mt-1 text-[13px] font-semibold text-slate-500">{desc}</p>}
        </div>
      </div>
      {disabled ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-500">
          {disabledReason ?? "지금은 사용할 수 없습니다."}
        </p>
      ) : (
        <div className="mt-4">{children}</div>
      )}
      {always && <div className="mt-4 border-t border-slate-100 pt-4">{always}</div>}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[13px] font-bold text-slate-600">{label}</label>
      {children}
    </div>
  );
}

// ── 회차 설정 ─────────────────────────────────────────────────────
function SessionCard({
  session, onSaved, notify,
}: { session: SessionDetail; onSaved: () => void; notify: (m: string) => void }) {
  const [name, setName] = useState(session.managerDisplayName ?? "");
  const [saving, setSaving] = useState(false);
  const locked = session.editable === "NONE";

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/pilots/${session.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ managerDisplayName: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { notify(data?.message || "저장하지 못했습니다."); return; }
      notify("저장했습니다.");
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-black text-slate-900">회차 설정</h2>
      <p className="mt-1 text-[13px] font-semibold text-slate-500">
        위탁기관과 기간은 회차를 만든 뒤 바꿀 수 없습니다. 담당자 표시명만 언제든 입력·수정할 수 있습니다.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Field label="위탁기관">
          <input value={session.agencyName} readOnly className={`${T.input} bg-slate-50 text-slate-500`} />
        </Field>
        <Field label="기간">
          <input value={`${session.startDate} ~ ${session.endDate}`} readOnly className={`${T.input} bg-slate-50 text-slate-500`} />
        </Field>
        <Field label="위탁기관 담당자 표시명">
          <div className="flex gap-2">
            <input
              value={name} onChange={(e) => setName(e.target.value)} disabled={locked}
              placeholder="모르면 비워두세요" className={`${T.input} flex-1`}
            />
            <button type="button" onClick={save} disabled={saving || locked} className={T.btnSecondary}>저장</button>
          </div>
        </Field>
      </div>

      {!session.managerDisplayName && (
        <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-[13px] font-bold text-sky-700">
          담당자 이름을 비워 두면 PDF에 수기로 적을 공간이 나옵니다.
        </p>
      )}
      {locked && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[13px] font-bold text-slate-500">
          종료·취소된 회차는 수정할 수 없습니다(이미 만든 문서와 어긋나지 않도록).
        </p>
      )}
    </section>
  );
}

// ── 훈련생 ────────────────────────────────────────────────────────
function TraineeForm({
  sessionId, sites, onDone, post,
}: {
  sessionId: string; sites: { id: string; companyName: string }[];
  onDone: () => void; post: (u: string, b: unknown) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
}) {
  const [siteId, setSiteId] = useState("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState("M");
  const [disabilityType, setDisabilityType] = useState("지적");
  const [severity, setSeverity] = useState("심하지 않은");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try {
      const { ok } = await post(`/api/admin/pilots/${sessionId}/resources`, {
        kind: "trainee", siteId, name, gender, disabilityType, severity,
      });
      if (ok) { setName(""); onDone(); }
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="사업체">
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className={T.input}>
            <option value="">선택</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
          </select>
        </Field>
        <Field label="훈련생 성명">
          <input value={name} onChange={(e) => setName(e.target.value)} className={T.input} />
        </Field>
        <Field label="성별">
          <select value={gender} onChange={(e) => setGender(e.target.value)} className={T.input}>
            <option value="M">남</option><option value="F">여</option>
          </select>
        </Field>
        <Field label="장애 유형">
          <input value={disabilityType} onChange={(e) => setDisabilityType(e.target.value)} className={T.input} />
        </Field>
        <Field label="장애 정도">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={T.input}>
            <option value="심하지 않은">심하지 않은</option>
            <option value="심한">심한</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <button type="button" onClick={submit} disabled={saving || !siteId || !name} className={T.btnPrimary}>
          {saving ? "등록 중…" : "훈련생 등록"}
        </button>
      </div>
    </>
  );
}

// ── 참여자 ────────────────────────────────────────────────────────
function ParticipantForm({
  sessionId, sites, trainees, period, onDone, post,
}: {
  sessionId: string;
  sites: { id: string; companyName: string }[];
  trainees: { id: string; name: string; siteId: string }[];
  period: { start: string; end: string };
  onDone: () => void;
  post: (u: string, b: unknown) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  // ★워커 전체 목록을 받지 않는다 — 선택지 하나 만들자고 PII를 통째로 전송하지 않기 위해 검색형으로 둔다.
  const [workerQ, setWorkerQ] = useState("");
  const [workerHits, setWorkerHits] = useState<{ id: string; workerName: string; phoneNumber: string }[]>([]);
  const [workerLoading, setWorkerLoading] = useState(false);
  const [workerErr, setWorkerErr] = useState("");

  async function searchWorkers() {
    const q = workerQ.trim();
    if (q.length < 2) { setWorkerErr("2자 이상 입력해주세요."); return; }
    setWorkerLoading(true); setWorkerErr("");
    try {
      const res = await fetch(`/api/admin/pilots/options?kind=workers&q=${encodeURIComponent(q)}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { setWorkerErr(data?.message || "검색에 실패했습니다."); return; }
      setWorkerHits(data.workers ?? []);
      if ((data.workers ?? []).length === 0) setWorkerErr("검색 결과가 없습니다.");
    } catch {
      setWorkerErr("검색에 실패했습니다.");
    } finally {
      setWorkerLoading(false);
    }
  }
  const [siteId, setSiteId] = useState("");
  const [workerId, setWorkerId] = useState("");
  const [traineeIds, setTraineeIds] = useState<string[]>([]);
  const [start, setStart] = useState(period.start);
  const [end, setEnd] = useState(period.end);
  const [workType, setWorkType] = useState("FULL_DAY");
  const [serviceStep, setServiceStep] = useState("FIELD_TRAINING");
  const [saving, setSaving] = useState(false);

  const siteTrainees = trainees.filter((t) => !siteId || t.siteId === siteId);

  async function submit() {
    setSaving(true);
    try {
      const { ok } = await post(`/api/admin/pilots/${sessionId}/participants`, {
        siteId,
        workerId: mode === "existing" ? workerId : null,
        traineeIds,
        assignmentStartDate: start, assignmentEndDate: end,
        workType, serviceStep,
      });
      if (ok) { setWorkerId(""); setTraineeIds([]); onDone(); }
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="mb-3 flex gap-2">
        {(["existing", "new"] as const).map((m) => (
          <button
            key={m} type="button" onClick={() => setMode(m)}
            className={`rounded-xl px-3 py-1.5 text-sm font-bold ${
              mode === m ? "bg-slate-950 text-white" : "border border-slate-200 bg-white text-slate-600"
            }`}
          >
            {m === "existing" ? "기존 계정" : "신규 계정"}
          </button>
        ))}
      </div>

      <p className="mb-3 text-[13px] font-semibold text-slate-500">
        {mode === "existing"
          ? "배정과 담당 관계를 지금 만들고, 이후 초대 코드로 연결합니다."
          : "배정 설정만 저장하고, 초대를 수락할 때 계정·배정·담당 관계가 함께 만들어집니다."}
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="사업체">
          <select value={siteId} onChange={(e) => { setSiteId(e.target.value); setTraineeIds([]); }} className={T.input}>
            <option value="">선택</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
          </select>
        </Field>
        {mode === "existing" && (
          <Field label="직무지도원 (이름·연락처로 검색)">
            <div className="flex gap-2">
              <input
                value={workerQ}
                onChange={(e) => { setWorkerQ(e.target.value); setWorkerId(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchWorkers(); } }}
                placeholder="2자 이상 입력 후 검색"
                className={`${T.input} flex-1`}
              />
              <button type="button" onClick={() => void searchWorkers()} disabled={workerLoading} className={T.btnSecondary}>
                {workerLoading ? "검색 중…" : "검색"}
              </button>
            </div>
          </Field>
        )}
        <Field label="업무 단계">
          <select value={serviceStep} onChange={(e) => setServiceStep(e.target.value)} className={T.input}>
            {SERVICE_STEPS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="근무형태">
          <select value={workType} onChange={(e) => setWorkType(e.target.value)} className={T.input}>
            {WORK_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </Field>
        <Field label="배정 시작일">
          <input type="date" value={start} min={period.start} max={period.end} onChange={(e) => setStart(e.target.value)} className={T.input} />
        </Field>
        <Field label="배정 종료일">
          <input type="date" value={end} min={period.start} max={period.end} onChange={(e) => setEnd(e.target.value)} className={T.input} />
        </Field>
      </div>

      {mode === "existing" && workerErr && (
        <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-bold text-rose-600">{workerErr}</p>
      )}

      {mode === "existing" && workerHits.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {workerHits.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => { setWorkerId(w.id); setWorkerQ(`${w.workerName} (${w.phoneNumber})`); setWorkerHits([]); }}
              className={`w-full border-b border-slate-50 px-4 py-2.5 text-left transition last:border-b-0 hover:bg-slate-50 ${
                workerId === w.id ? "bg-emerald-50" : ""
              }`}
            >
              <span className="text-sm font-bold text-slate-800">{w.workerName}</span>
              <span className="ml-2 text-sm font-semibold text-slate-500">{w.phoneNumber}</span>
            </button>
          ))}
        </div>
      )}

      {mode === "existing" && workerId && workerHits.length === 0 && (
        <p className="mt-2 text-[13px] font-bold text-emerald-700">선택됨: {workerQ}</p>
      )}

      <div className="mt-3">
        <p className="mb-1 text-[13px] font-bold text-slate-600">담당 훈련생</p>
        {siteTrainees.length === 0 ? (
          <p className="text-[13px] font-semibold text-slate-400">사업체를 선택하면 훈련생이 표시됩니다.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {siteTrainees.map((t) => {
              const on = traineeIds.includes(t.id);
              return (
                <button
                  key={t.id} type="button"
                  onClick={() => setTraineeIds((prev) => on ? prev.filter((x) => x !== t.id) : [...prev, t.id])}
                  className={`rounded-xl px-3 py-1.5 text-sm font-bold ${
                    on ? "bg-emerald-600 text-white" : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="mt-2 text-[13px] font-semibold text-slate-400">
        배정 기간은 회차 기간({period.start} ~ {period.end}) 안이어야 합니다.
      </p>

      <div className="mt-3">
        <button
          type="button" onClick={submit}
          disabled={saving || !siteId || traineeIds.length === 0 || (mode === "existing" && !workerId)}
          className={T.btnPrimary}
        >
          {saving ? "추가 중…" : "참여자 추가"}
        </button>
      </div>
    </>
  );
}

// ── 참여자 목록 ───────────────────────────────────────────────────
function ParticipantList({
  sessionId, participants, setupOpen, onChanged, notify, post,
}: {
  sessionId: string; participants: Participant[]; setupOpen: boolean;
  onChanged: () => void; notify: (m: string) => void;
  post: (u: string, b: unknown) => Promise<{ ok: boolean; data: Record<string, unknown> }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // ★신규 참여자의 연락처는 인라인 입력으로 받는다(manager/workers 초대 흐름과 동일).
  //  window.prompt는 이 리포 어디에도 쓰지 않는 패턴이고, 렌더러를 멈춰 세운다.
  const [phoneFor, setPhoneFor] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [nameInput, setNameInput] = useState("");

  /**
   * @param requireName 신규 참여자면 성명도 필수. 비우면 초대가 발급됐는데도 목록이
   *   "신규(미발급)"으로 보여, 발급 여부를 화면에서 구분할 수 없게 된다.
   */
  async function issue(participantId: string, phone: string, workerName?: string, requireName?: boolean) {
    const p = phone.replace(/-/g, "").trim();
    const n = workerName?.trim() ?? "";
    if (requireName && n.length < 2) { notify("직무지도원 성명을 2자 이상 입력해주세요."); return; }
    if (!p) { notify("연락처를 입력해주세요."); return; }
    setBusy(participantId);
    try {
      const { ok } = await post(`/api/admin/pilots/${sessionId}/invites`, {
        participantId, phoneNumber: p, workerName: n || undefined,
      });
      if (ok) {
        notify("초대를 발급했습니다.");
        setPhoneFor(null); setPhoneInput(""); setNameInput("");
        onChanged();
      }
    } finally { setBusy(null); }
  }

  async function cancel(p: Participant) {
    if (!window.confirm(`${p.workerName ?? "이 참여자"}의 참여를 취소할까요? 발급된 초대도 무효화됩니다.`)) return;
    setBusy(p.id);
    try {
      const res = await fetch(`/api/admin/pilots/${sessionId}/participants/${p.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!data?.success) { notify(data?.message || "취소하지 못했습니다."); return; }
      notify("참여를 취소했습니다.");
      onChanged();
    } finally { setBusy(null); }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-black text-slate-900">참여자</h2>
      {participants.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-slate-400">아직 추가된 참여자가 없습니다.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full table-fixed">
            <colgroup>
              <col className="w-[150px]" /><col className="w-[90px]" /><col className="w-[150px]" />
              <col className="w-[180px]" /><col className="w-[140px]" /><col className="w-[160px]" />
            </colgroup>
            <thead>
              <tr>{["직무지도원", "상태", "사업체", "담당 훈련생", "초대", "작업"].map((h) => (
                <th key={h} className={T.th}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {participants.map((p) => {
                const s = PARTICIPANT_STATUS[p.status] ?? { label: p.status, cls: "bg-slate-100 text-slate-600" };
                const canIssue = setupOpen && p.status === "CONFIGURED" && !p.invite;
                const canCancel = setupOpen && p.status !== "ACCEPTED" && p.status !== "CANCELLED";
                return (
                  <Fragment key={p.id}>
                  <tr className={T.trBase}>
                    <td className={`${T.td} truncate`}>
                      {/* 신규 참여자는 초대 발급 때 받은 이름이 초대에 남는다(익명으로만 두지 않는다). */}
                      {p.workerName ?? p.inviteWorkerName ?? (
                        <span className="text-slate-400">
                          {p.invite ? "신규(성명 미입력)" : "신규(미발급)"}
                        </span>
                      )}
                    </td>
                    <td className={T.td}>
                      <span className={`inline-block rounded-lg px-2 py-0.5 text-xs font-bold ${s.cls}`}>{s.label}</span>
                    </td>
                    <td className={`${T.td} truncate`}>{p.siteName ?? "-"}</td>
                    <td className={`${T.td} truncate`}>{p.trainees.map((t) => t.name).join(", ") || "-"}</td>
                    <td className={`${T.td} truncate`}>
                      {p.invite
                        ? <span className={p.invite.used ? "text-slate-400" : "font-black text-slate-900"}>
                            {p.invite.code}{p.invite.used ? " (사용됨)" : ""}
                          </span>
                        : <span className="text-slate-400">미발급</span>}
                    </td>
                    <td className={T.td}>
                      <div className="flex gap-1">
                        {canIssue && phoneFor !== p.id && (
                          <button
                            type="button"
                            onClick={() => {
                              // 신규 참여자는 아래 행에서 이름·연락처를 받는다(표 폭을 넘기지 않게).
                              if (p.isNewWorker) { setPhoneFor(p.id); setPhoneInput(""); setNameInput(""); }
                              else void issue(p.id, p.workerPhone ?? "");
                            }}
                            disabled={busy === p.id}
                            className={T.btnSecondary}
                          >
                            초대 발급
                          </button>
                        )}
                        {canCancel && (
                          <button type="button" onClick={() => cancel(p)} disabled={busy === p.id} className={T.btnDanger}>
                            취소
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {phoneFor === p.id && (
                    // ★입력을 행 아래로 펼친다. 작업 열(w-160) 안에 넣으면 표가 가로로 넘쳐
                    //  취소 버튼이 잘린다(table-fixed).
                    <tr className="border-b border-slate-50 bg-slate-50/60">
                      <td colSpan={6} className="px-3 py-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <div>
                            <label className="mb-1 block text-[13px] font-bold text-slate-600">성명 <span className="text-rose-500">*</span></label>
                            <input
                              value={nameInput}
                              onChange={(e) => setNameInput(e.target.value)}
                              placeholder="직무지도원 성명"
                              autoFocus
                              className={`${T.input} w-40`}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[13px] font-bold text-slate-600">연락처</label>
                            <input
                              value={phoneInput}
                              onChange={(e) => setPhoneInput(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void issue(p.id, phoneInput, nameInput, true); } }}
                              placeholder="01012345678"
                              className={`${T.input} w-44`}
                            />
                          </div>
                          <button type="button" onClick={() => void issue(p.id, phoneInput, nameInput, true)} disabled={busy === p.id || nameInput.trim().length < 2 || !phoneInput.trim()} className={T.btnPrimary}>
                            발급
                          </button>
                          <button type="button" onClick={() => { setPhoneFor(null); setPhoneInput(""); setNameInput(""); }} className={T.btnSecondary}>
                            취소
                          </button>
                          <p className="w-full text-[13px] font-semibold text-slate-400">
                            입력한 성명은 초대에 기록되어 목록에 표시됩니다. 계정 이름은 본인이 가입할 때 확정합니다.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
