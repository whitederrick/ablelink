"use client";

/**
 * admlink-admin / 근태 인박스 (Master–Detail) - v3 prototype
 * ✅ 사용자 시안 반영 포인트
 * 1) 기간 사용자지정(From~To)을 "사용자 지정" 버튼 옆(같은 줄)으로 이동 → 상단 높이 축소
 * 2) 좌/우 폭 비율을 시안처럼(좌 4 / 우 8 @xl, 좌 5 / 우 7 @lg)로 정리
 * 3) 상세 상단의 "기준범위 이탈" 배지 위치를 시안처럼(헤더 좌측 아래)로 조정
 * 4) 액션 버튼은 상태에 따라 노출(사유등록요청 / 보완요청 / 처리완료)
 * 5) 목록은 pageItems.map으로 실제 데이터만 렌더(빈 슬롯 렌더 제거)
 * 6) 목록에서는 "범위이탈" 배지를 숨김(상세에서만 노출)
 */

import React, { useEffect, useMemo, useState } from "react";
import PageHeader from "../../_components/PageHeader";
import Pagination from "../../_components/Pagination";
import { T } from "../../_styles";

type IssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
type IssueFilter = IssueType | "ALL";

type InboxStatus =
  | "ADMIN_UNCONFIRMED"
  | "WORKER_CONFIRM_REQUESTED"
  | "WORKER_REASON_MISSING"
  | "WORKER_REPLIED"
  | "ADMIN_RESOLVED";

type PeriodPreset = "TODAY" | "LAST_7" | "LAST_14" | "LAST_30" | "CUSTOM";

type TimelineEvent = {
  id: string;
  at: string; // ISO
  label: string;
  detail?: string | null;
};

type WorkType = "AM" | "PM" | "FULL";

type InboxItem = {
  id: string;

  workerName: string;
  siteName: string;
  workDate: string; // YYYY-MM-DD

  issueTypes: IssueType[]; // 여러 개 가능
  status: InboxStatus;

  workType?: WorkType; // ✅ 근무형태
  expectedStartAt?: string; // ✅ 기준 출근시간 "HH:MM" (없으면 workType 기본값 사용)

  clockInAt?: string | null;
  clockOutAt?: string | null;
  actualClockInAt?: string | null;  // 실제 출근 버튼 시각(지각 판정 근거)
  actualClockOutAt?: string | null; // 실제 퇴근 버튼 시각

  rangeM?: number | null;
  startDistanceM?: number | null;
  endDistanceM?: number | null;

  workerReasonText?: string | null;
  adminMemo?: string | null;

  // 급여 보호 게이트
  payrollPending?: boolean;       // 심한지각/조퇴(30분+) 미컨펌 → 출근부 '보정대기'(급여 보류)
  lateMinutes?: number | null;    // 표준 대비 실제 지각(분)
  earlyLeaveMinutes?: number | null; // 표준 대비 실제 조퇴(분)
  payrollConfirmedAt?: string | null;
  correctionRequestedAt?: string | null; // 위탁기관→워커 시각 보정 요청 시각
  seriousLateMin?: number;        // 심한지각/조퇴 기준(분, 기본 30)
  missedClockOut?: boolean;       // 퇴근 미실행(과거 WORKING·미확정) → 매니저 표준시각 확정 가능
  hasPendingEdit?: boolean;       // 직무지도원이 제출한 수정요청이 승인 대기 중 → 보정요청 대신 '검토' 유도

  updatedAt: string; // ISO
  timeline: TimelineEvent[];
};

type ModalState =
  | { type: "NONE" }
  | { type: "REQUEST_REASON"; draft: string }
  | { type: "REQUEST_SUPPLEMENT"; draft: string };

const ISSUE_LABEL: Record<IssueType, string> = {
  OUT_OF_RANGE: "기준 범위이탈",
  TIME_ANOMALY: "출퇴근 시간 이상",
  MISSING_CLOCK_IN: "출근 기록 누락",
  MISSING_CLOCK_OUT: "퇴근 기록 누락",
};

// 콘솔 공통 소프트 톤(StatusBadge 팔레트)로 톤다운
const ISSUE_STYLE: Record<IssueType, { className: string }> = {
  OUT_OF_RANGE: { className: "bg-amber-50 text-amber-600" }, // 기준 범위 이탈
  TIME_ANOMALY: { className: "bg-amber-50 text-amber-600" }, // 출퇴근 시간이상
  MISSING_CLOCK_IN: { className: "bg-rose-50 text-rose-600" }, // 출근 기록 누락
  MISSING_CLOCK_OUT: { className: "bg-rose-50 text-rose-600" }, // 퇴근 기록 누락
};

const STATUS_LABEL: Record<InboxStatus, string> = {
  ADMIN_UNCONFIRMED: "담당자 미확인",
  WORKER_CONFIRM_REQUESTED: "직무지도원 확인 요청",
  WORKER_REASON_MISSING: "직무지도원 사유 미제출",
  WORKER_REPLIED: "직무지도원 회신 완료",
  ADMIN_RESOLVED: "담당자 처리 완료",
};

function cx(...arr: Array<string | false | null | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + delta);
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, "0");
  const dd = String(base.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtYmdDots(ymd: string) {
  return ymd.replaceAll("-", ".");
}

function fmtTime(iso?: string | null) {
  if (!iso) return "미입력";
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

function resolvePeriod(preset: PeriodPreset, customFrom: string, customTo: string) {
  const t = todayISO();
  if (preset === "TODAY") return { from: t, to: t };
  if (preset === "LAST_7") return { from: addDays(t, -6), to: t };
  if (preset === "LAST_14") return { from: addDays(t, -13), to: t };
  if (preset === "LAST_30") return { from: addDays(t, -29), to: t };
  return { from: customFrom, to: customTo };
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function buildReasonRequestMessage(item: InboxItem) {
  const lines: string[] = [];
  const issues = item.issueTypes.map((t) => `“${ISSUE_LABEL[t]}”`).join(", ");
  lines.push(`${issues} 관련 사유 입력을 요청합니다.`);
  lines.push("");
  lines.push("- 해당 이슈 발생 원인");
  lines.push("- 재발 방지/조치 내용(필요 시)");
  lines.push("");
  lines.push("감사합니다.");
  return lines.join("\n");
}

function buildSupplementRequestMessage() {
  const lines: string[] = [];
  lines.push("등록된 사유가 불충분하여 보완을 요청합니다.");
  lines.push("");
  lines.push("- 구체적인 경위(시간/장소/상황)");
  lines.push("- 증빙 가능 여부(필요 시)");
  lines.push("");
  lines.push("감사합니다.");
  return lines.join("\n");
}

// ✅ 실제 API 호출 (mock 제거)
// - 실패해도 화면이 죽지 않도록 [] 반환 + console.error
async function fetchInboxItems(filters: {
  q: string;
  period: PeriodPreset;
  customFrom: string;
  customTo: string;
  statuses: InboxStatus[];
  issue: IssueFilter;
}): Promise<InboxItem[]> {
  try {
    const { from, to } = resolvePeriod(filters.period, filters.customFrom, filters.customTo);

    const sp = new URLSearchParams();
    if (filters.q.trim()) sp.set("q", filters.q.trim());
    if (from) sp.set("from", from);
    if (to) sp.set("to", to);
    sp.set("issue", filters.issue);
    if (filters.statuses.length > 0) sp.set("statuses", filters.statuses.join(","));

    const res = await fetch(`/api/admin/attendance-inbox?${sp.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      console.error("[attendance-inbox fetch failed]", res.status, json);
      return [];
    }

    const items: InboxItem[] = (json.items || []).map((it: any) => {
      const wt = (it.workType ?? undefined) as WorkType | undefined;
      const safeWorkType: WorkType | undefined = wt === "AM" || wt === "PM" || wt === "FULL" ? wt : undefined;

      return {
        id: String(it.id),

        workerName: String(it.workerName ?? "-"),
        siteName: String(it.siteName ?? "-"),
        workDate: String(it.workDate),

        issueTypes: (it.issueTypes || []) as IssueType[],
        status: it.status as InboxStatus,

        workType: safeWorkType,
        expectedStartAt: it.expectedStartAt ?? undefined,

        clockInAt: it.clockInAt ?? null,
        clockOutAt: it.clockOutAt ?? null,
        actualClockInAt: it.actualClockInAt ?? null,
        actualClockOutAt: it.actualClockOutAt ?? null,

        rangeM: it.rangeM ?? null,
        startDistanceM: it.startDistanceM ?? null,
        endDistanceM: it.endDistanceM ?? null,

        workerReasonText: it.workerReasonText ?? null,
        adminMemo: it.adminMemo ?? null,

        payrollPending: Boolean(it.payrollPending),
        lateMinutes: it.lateMinutes ?? null,
        earlyLeaveMinutes: it.earlyLeaveMinutes ?? null,
        payrollConfirmedAt: it.payrollConfirmedAt ?? null,
        correctionRequestedAt: it.correctionRequestedAt ?? null,
        seriousLateMin: typeof it.seriousLateMin === "number" ? it.seriousLateMin : 30,
        missedClockOut: Boolean(it.missedClockOut),
        hasPendingEdit: Boolean(it.hasPendingEdit),

        updatedAt: String(it.updatedAt || new Date().toISOString()),
        timeline: Array.isArray(it.timeline) ? it.timeline : [],
      };
    });

    return items;
  } catch (e) {
    console.error("[attendance-inbox fetch error]", e);
    return [];
  }
}

async function apiCallJson<T>(
  url: string,
  init: RequestInit
): Promise<{ ok: boolean; status: number; json: T | null }> {
  try {
    const res = await fetch(url, { cache: "no-store", ...init });
    const json = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

async function postJson<T>(url: string, body?: any) {
  return apiCallJson<T>(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function patchJson<T>(url: string, body?: any) {
  return apiCallJson<T>(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function Chip({
  children,
  active,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition",
        active
          // 이슈 필터(tone=danger)는 보정대기(급여보류)와 동일한 로즈, 그 외(기간·처리상태)는 검정으로 통일
          ? tone === "danger"
            ? "border-rose-400 bg-rose-400 text-white"
            : "border-slate-950 bg-slate-950 text-white"
          : tone === "danger"
          ? "border-rose-200 bg-white text-rose-600 hover:bg-rose-50"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="text-sm font-semibold">{title}</div>
      {note ? <div className="text-xs text-slate-400">※ {note}</div> : null}
    </div>
  );
}

function getAvailableActions(it: InboxItem) {
  // 상태 기반 액션 노출 규칙:
  // (미확인/확인요청/사유미제출)=>사유등록요청,
  // (회신완료)=>보완요청+처리완료,
  // (처리완료)=>숨김.
  const s = it.status;
  const showRequestReason =
    s === "ADMIN_UNCONFIRMED" || s === "WORKER_CONFIRM_REQUESTED" || s === "WORKER_REASON_MISSING";
  const showSupplementAndResolve = s === "WORKER_REPLIED";
  const showNone = s === "ADMIN_RESOLVED";

  return {
    showRequestReason,
    showSupplementAndResolve,
    showNone,
  };
}

export default function AttendanceInboxClient() {
  const base = todayISO();

  /** filters */
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<PeriodPreset>("LAST_14");
  const [customFrom, setCustomFrom] = useState(addDays(base, -13));
  const [customTo, setCustomTo] = useState(base);
  const [issue, setIssue] = useState<IssueFilter>("ALL");
  const [onlyPayrollPending, setOnlyPayrollPending] = useState(false);

  // 기본: 처리완료는 숨김(필요 시 포함)
  const [statuses, setStatuses] = useState<InboxStatus[]>([
    "ADMIN_UNCONFIRMED",
    "WORKER_CONFIRM_REQUESTED",
    "WORKER_REASON_MISSING",
    "WORKER_REPLIED",
  ]);

  /** data */
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** pagination */
  const pageSize = 10;
  const [page, setPage] = useState(1);

  // 딥링크(대시보드 운영 리스크 → ?q=대상&focus=id): 검색 시드 + 기간 확장(LAST_30) + 포커스 대상 기억
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const sq = sp.get("q");
    const sf = sp.get("focus");
    if (sq) { setQ(sq); setPeriod("LAST_30"); }  // 과거 건도 보이도록 기간 확장
    if (sf) setFocusId(sf);
  }, []);

  const selected = useMemo(() => items.find((x) => x.id === selectedId) ?? null, [items, selectedId]);

  // 보정대기(급여 보류)만 보기 필터 — 클라이언트 측
  const viewItems = useMemo(
    () => (onlyPayrollPending ? items.filter((x) => x.payrollPending) : items),
    [items, onlyPayrollPending],
  );
  const payrollPendingCount = useMemo(() => items.filter((x) => x.payrollPending).length, [items]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(viewItems.length / pageSize)), [viewItems.length]);
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return viewItems.slice(start, start + pageSize);
  }, [viewItems, page]);

  // 딥링크 포커스: 대상이 로드되면 해당 페이지로 이동 + 선택 + 스크롤(1회)
  useEffect(() => {
    if (!focusId) return;
    const idx = viewItems.findIndex((x) => x.id === focusId);
    if (idx < 0) return; // 아직 로드 전이거나 현재 필터 범위 밖
    setPage(Math.floor(idx / pageSize) + 1);
    setSelectedId(focusId);
    const fid = focusId;
    setFocusId(null);
    setTimeout(() => {
      document.querySelector(`[data-item-id="${fid}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  }, [focusId, viewItems]);


  /** load */
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const data = await fetchInboxItems({ q, period, customFrom, customTo, statuses, issue });
        if (!alive) return;

        setItems(data);
        setPage(1);
        setSelectedId((prev) => {
          if (prev && data.some((d) => d.id === prev)) return prev;
          return data[0]?.id ?? null;
        });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [q, period, customFrom, customTo, statuses, issue]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => { setPage(1); }, [onlyPayrollPending]);

  /** status toggle (multi) */
  function toggleStatus(s: InboxStatus) {
    setStatuses((prev) => {
      const has = prev.includes(s);
      const next = has ? prev.filter((x) => x !== s) : [...prev, s];
      return next.length ? next : prev;
    });
  }

  /** actions (DB 연동: 일부 엔드포인트는 없을 수 있으므로 실패 시 UI만 업데이트) */
  const [modal, setModal] = useState<ModalState>({ type: "NONE" });
  const [savingMemo, setSavingMemo] = useState(false);

  function pushTimeline(it: InboxItem, label: string, detail?: string | null) {
    const nextEvent: TimelineEvent = { id: uid("tl"), at: new Date().toISOString(), label, detail: detail ?? null };
    return { ...it, timeline: [nextEvent, ...it.timeline], updatedAt: new Date().toISOString() };
  }

  function updateSelected(mutator: (it: InboxItem) => InboxItem) {
    if (!selected) return;
    setItems((prev) => prev.map((it) => (it.id === selected.id ? mutator(it) : it)));
  }

  function actionRequestReason() {
    if (!selected) return;
    setModal({ type: "REQUEST_REASON", draft: buildReasonRequestMessage(selected) });
  }

  function actionRequestSupplement() {
    if (!selected) return;
    setModal({ type: "REQUEST_SUPPLEMENT", draft: buildSupplementRequestMessage() });
  }

  async function actionResolve() {
    if (!selected) return;

    // ✅ 서버 엔드포인트가 있으면 호출, 없으면 로컬만 업데이트
    const { ok } = await postJson<{ success: boolean }>(`/api/admin/attendance-inbox/${selected.id}/resolve`).catch(
      () => ({ ok: false, status: 0, json: null })
    );

    updateSelected((it) =>
      pushTimeline(
        { ...it, status: "ADMIN_RESOLVED" },
        "담당자 종결 처리 완료",
        ok ? "종결 처리(서버 반영)" : "종결 처리(로컬 반영)"
      )
    );
  }

  const [requestingCorrection, setRequestingCorrection] = useState(false);
  async function actionRequestCorrection() {
    if (!selected) return;
    setRequestingCorrection(true);
    try {
      const { ok, json } = await postJson<{ success: boolean; correctionRequestedAt?: string; message?: string }>(
        `/api/admin/attendance-inbox/${selected.id}/request-correction`,
      ).catch(() => ({ ok: false, status: 0, json: null as any }));
      if (ok && json?.success) {
        const at = json.correctionRequestedAt ?? new Date().toISOString();
        updateSelected((it) => ({ ...it, correctionRequestedAt: at, updatedAt: new Date().toISOString() }));
      } else {
        alert(json?.message || "요청에 실패했습니다.");
      }
    } finally {
      setRequestingCorrection(false);
    }
  }

  const [confirmingMissed, setConfirmingMissed] = useState(false);
  async function actionConfirmMissedClockOut() {
    if (!selected) return;
    if (!confirm(`${selected.workDate} 퇴근 미실행 건을 표준 퇴근시각으로 확정할까요?\n확정 후에는 수정이 불가합니다.`)) return;
    setConfirmingMissed(true);
    try {
      const { ok, json } = await postJson<{ success: boolean; message?: string }>(
        `/api/admin/attendance-inbox/${selected.id}/confirm-missed-clockout`,
      ).catch(() => ({ ok: false, status: 0, json: null as any }));
      if (ok && json?.success) {
        updateSelected((it) => pushTimeline(
          { ...it, missedClockOut: false, status: "ADMIN_RESOLVED", updatedAt: new Date().toISOString() },
          "퇴근 미실행 표준시각 확정",
          "매니저 확정(표준 퇴근시각)",
        ));
      } else {
        alert(json?.message || "확정에 실패했습니다.");
      }
    } finally {
      setConfirmingMissed(false);
    }
  }

  async function saveAdminMemo() {
    if (!selected) return;

    const memo = selected.adminMemo ?? "";
    setSavingMemo(true);
    try {
      const { ok } = await patchJson<{ success: boolean }>(`/api/admin/attendance-inbox/${selected.id}/memo`, { memo }).catch(
        () => ({ ok: false, status: 0, json: null })
      );

      updateSelected((it) => pushTimeline(it, ok ? "운영 메모 저장" : "운영 메모 저장(로컬)", memo ? memo : null));
    } finally {
      setSavingMemo(false);
    }
  }

  /** derived (detail) */
  const detailBadges = useMemo(() => {
    if (!selected) return [];
    // ✅ 목록과 동일한 규칙/순서로 이슈 도출
    const derived = deriveIssueTypes(selected);
    return derived.map((t) => ({ key: t, type: t }));
  }, [selected]);

  const periodLabel = useMemo(() => {
    if (period === "TODAY") return "오늘";
    if (period === "LAST_7") return "최근 7일";
    if (period === "LAST_14") return "최근 14일";
    if (period === "LAST_30") return "최근 30일";
    return "사용자 지정";
  }, [period]);

  const actions = useMemo(() => (selected ? getAvailableActions(selected) : null), [selected]);

  function deriveIssueTypes(it: InboxItem): IssueType[] {
    const set = new Set<IssueType>();

    // 1) 출근 기록 누락
    if (!it.clockInAt) set.add("MISSING_CLOCK_IN");

    // 2) 퇴근 기록 누락
    if (!it.clockOutAt) set.add("MISSING_CLOCK_OUT");

    // 4) 기준 범위 이탈: 거리 > rangeM 이면
    const rangeM = it.rangeM ?? null;
    if (rangeM != null) {
      const startBad = it.startDistanceM != null && it.startDistanceM > rangeM;
      const endBad = it.endDistanceM != null && it.endDistanceM > rangeM;
      if (startBad || endBad) set.add("OUT_OF_RANGE");
    }

    // ✅ Step 3) 지각(TIME_ANOMALY) — 실제 출근 버튼 시각 기준(고정시각 아님).
    //    실제 시각 없으면(과거 기록·일괄생성) 판정 안 함. 지각 기준=현장/기관 설정값(seriousLateMin, 기본 30).
    const expectedStartMin = getExpectedStartMin(it);
    const actualInMin = isoToLocalMin(it.actualClockInAt);
    const lateThreshold = Math.max(it.seriousLateMin ?? 30, 1); // 0(무관용)도 1분 이상 지각부터
    if (expectedStartMin != null && actualInMin != null && actualInMin - expectedStartMin >= lateThreshold) {
      set.add("TIME_ANOMALY");
    }

    return Array.from(set);
  }

  function getListIssueBadges(it: InboxItem) {
    const derived = deriveIssueTypes(it);
    const shown = derived.slice(0, 3);
    const rest = Math.max(0, derived.length - shown.length);
    const hasAny = derived.length > 0;
    return { shown, rest, hasAny };
  }

  function hhmmToMin(hhmm: string): number | null {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
    if (!m) return null;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  function isoToLocalMin(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }

  function getExpectedStartMin(it: InboxItem): number | null {
    // 1) item에 기준시간이 있으면 그걸 사용
    if (it.expectedStartAt) return hhmmToMin(it.expectedStartAt);

    // 2) 없으면 근무형태 기본값
    if (it.workType === "AM") return 9 * 60;
    if (it.workType === "PM") return 13 * 60;
    if (it.workType === "FULL") return 9 * 60;

    return null;
  }

  return (
    <div className="pb-6">
      {/* ===== Header ===== */}
      <PageHeader
        title="근태 이슈 확인"
        sub="근태 관련 이슈를 파악하고, 근태 이슈 발생 사유를 확인합니다."
      />

      {/* ===== Top Filter Bar (시안 구조) ===== */}
      <div className="mb-5 rounded-xl border border-slate-100 bg-white p-4">
        <div className="grid grid-cols-12 gap-3">
          {/* 통합 검색 */}
          <div className="col-span-12 lg:col-span-6">
            <label className="mb-1 block text-sm font-semibold text-slate-700">통합 검색</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="직무지도원명 / Site명 / 날짜(예: 2/3, 2026-02-03)"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-sky-100 focus:border-sky-400"
            />
          </div>

          {/* 기간 조회 */}
          <div className="col-span-12 lg:col-span-6">
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-semibold text-slate-700">기간 조회</label>
              <span className="ml-auto text-xs text-slate-400">
                선택: <span className="font-semibold text-rose-700">{periodLabel}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip active={period === "TODAY"} onClick={() => setPeriod("TODAY")}>
                오늘
              </Chip>
              <Chip active={period === "LAST_7"} onClick={() => setPeriod("LAST_7")}>
                최근 7일
              </Chip>
              <Chip active={period === "LAST_14"} onClick={() => setPeriod("LAST_14")}>
                최근 14일
              </Chip>
              <Chip active={period === "LAST_30"} onClick={() => setPeriod("LAST_30")}>
                최근 30일
              </Chip>
              <Chip active={period === "CUSTOM"} onClick={() => setPeriod("CUSTOM")}>
                사용자 지정
              </Chip>

              {/* 사용자 지정 버튼 옆 from~to */}
              <div className="ml-auto flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  disabled={period !== "CUSTOM"}
                  className={cx("rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100", period !== "CUSTOM" ? "opacity-40" : "")}
                />
                <span className="text-slate-500">~</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  disabled={period !== "CUSTOM"}
                  className={cx("rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100", period !== "CUSTOM" ? "opacity-40" : "")}
                />
              </div>
            </div>
          </div>

          {/* 보정대기 건 확인(별도) + 이슈 필터(단일) — 보정대기는 단일선택과 별개로 좌측 분리 */}
          <div className="col-span-12 lg:col-span-6">
            <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
              {/* 보정대기 건 확인 — 큰 이슈 사항, 단일선택 이슈 필터와 독립 */}
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">보정대기 건 확인</label>
                <button
                  type="button"
                  onClick={() => setOnlyPayrollPending((v) => !v)}
                  className={cx(
                    "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold transition",
                    onlyPayrollPending
                      ? "border-rose-600 bg-rose-600 text-white"
                      : "border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
                  )}
                >
                  ⛔ 보정대기(급여보류)<span className="ml-1 inline-block w-5 text-center tabular-nums">{payrollPendingCount > 0 ? payrollPendingCount : ""}</span>
                </button>
              </div>

              {/* 이슈 필터(단일 선택) */}
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-sm font-semibold text-slate-700">이슈 필터(단일 선택)</label>
                <div className="flex flex-wrap gap-2">
                  <Chip active={issue === "ALL"} onClick={() => setIssue("ALL")}>전체</Chip>
                  <Chip active={issue === "OUT_OF_RANGE"} onClick={() => setIssue("OUT_OF_RANGE")}>기준 범위 이탈</Chip>
                  <Chip active={issue === "TIME_ANOMALY"} onClick={() => setIssue("TIME_ANOMALY")}>출퇴근 시간 이상</Chip>
                  <Chip active={issue === "MISSING_CLOCK_IN"} onClick={() => setIssue("MISSING_CLOCK_IN")}>출근 기록 누락</Chip>
                  <Chip active={issue === "MISSING_CLOCK_OUT"} onClick={() => setIssue("MISSING_CLOCK_OUT")}>퇴근 기록 누락</Chip>
                </div>
              </div>
            </div>
          </div>

          {/* 처리 상태 (복수) — 이슈 필터 우측, 기간 조회와 좌측 정렬(6/6) */}
          <div className="col-span-12 lg:col-span-6">
            <label className="mb-1 block text-sm font-semibold text-slate-700">처리 상태(복수 선택)</label>
            <div className="flex flex-wrap gap-2">
              <Chip active={statuses.includes("ADMIN_UNCONFIRMED")} onClick={() => toggleStatus("ADMIN_UNCONFIRMED")}>
                {STATUS_LABEL.ADMIN_UNCONFIRMED}
              </Chip>
              <Chip
                active={statuses.includes("WORKER_CONFIRM_REQUESTED")}
                onClick={() => toggleStatus("WORKER_CONFIRM_REQUESTED")}
              >
                {STATUS_LABEL.WORKER_CONFIRM_REQUESTED}
              </Chip>
              <Chip
                active={statuses.includes("WORKER_REASON_MISSING")}
                onClick={() => toggleStatus("WORKER_REASON_MISSING")}
              >
                {STATUS_LABEL.WORKER_REASON_MISSING}
              </Chip>
              <Chip active={statuses.includes("WORKER_REPLIED")} onClick={() => toggleStatus("WORKER_REPLIED")}>
                {STATUS_LABEL.WORKER_REPLIED}
              </Chip>
              <Chip active={statuses.includes("ADMIN_RESOLVED")} onClick={() => toggleStatus("ADMIN_RESOLVED")}>
                {STATUS_LABEL.ADMIN_RESOLVED}
              </Chip>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Main 2-pane ===== */}
      {/* 목록:상세 = 55:45 (11fr:9fr) — 우측을 원래(50:50) 대비 약 10% 축소 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[11fr_9fr]">
        {/* Left list */}
        <div className="min-w-0">
          <div className="h-full rounded-xl border border-slate-100 bg-white">
            <div className="flex items-center justify-between border-b border-gray-50 px-4 py-3">
              <div className="flex items-baseline gap-2">
                <div className="text-base font-semibold text-slate-800">목록 조회</div>
                {loading ? <div className="ml-1 text-sm text-sky-600">불러오는 중…</div> : null}
              </div>
              <div className="text-xs text-slate-400">정렬: 날짜 최신순</div>
            </div>

            {/* 목록 — 컬럼 테이블(다른 화면 표준, 제목·데이터 좌측 정렬) */}
            <div className="overflow-x-auto">
              <table className="w-full [&_th]:px-2.5 [&_td]:px-2.5">
                <thead>
                  <tr>
                    {/* 성명·현장·근무일·상태는 내용폭으로 고정(w-px), 이슈/보정 현황이 남는 너비를 차지 */}
                    <th className={`${T.th} w-px whitespace-nowrap`}>직무지도원 성명</th>
                    <th className={`${T.th} w-px whitespace-nowrap`}>현장(사업체)</th>
                    <th className={`${T.th} w-px whitespace-nowrap`}>근무일</th>
                    <th className={T.th}>이슈/보정 현황</th>
                    <th className={`${T.th} w-px whitespace-nowrap`}>처리 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">조건에 해당하는 항목이 없습니다.</td></tr>
                  ) : (
                    pageItems.map((it) => {
                      const active = it.id === selectedId;
                      const { shown, rest, hasAny } = getListIssueBadges(it);
                      return (
                        <tr
                          key={it.id}
                          data-item-id={it.id}
                          onClick={() => setSelectedId(it.id)}
                          className={cx(
                            "cursor-pointer border-b border-slate-50 transition",
                            active ? "bg-sky-50" : "hover:bg-slate-50"
                          )}
                        >
                          <td className={`${T.td} w-px whitespace-nowrap font-semibold text-slate-900`}>{it.workerName}</td>
                          <td className={`${T.td} w-px`}><div className="max-w-[140px] truncate">{it.siteName}</div></td>
                          <td className={`${T.td} w-px whitespace-nowrap`}>{fmtYmdDots(it.workDate)}</td>
                          <td className={T.td}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {it.payrollPending ? (
                                <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">보정대기</span>
                              ) : null}
                              {hasAny ? (
                                <>
                                  {shown.map((t) => (
                                    <span key={t} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ISSUE_STYLE[t].className}`}>{ISSUE_LABEL[t]}</span>
                                  ))}
                                  {rest > 0 ? (<span className="inline-flex items-center rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-slate-700">+{rest}</span>) : null}
                                </>
                              ) : (!it.payrollPending ? <span className="text-slate-300">-</span> : null)}
                            </div>
                          </td>
                          <td className={`${T.td} w-px whitespace-nowrap`}>
                            <span className={[
                              "inline-flex items-center justify-center whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white",
                              it.status === "ADMIN_RESOLVED" ? "bg-emerald-600"
                                : it.status === "WORKER_REPLIED" ? "bg-sky-600"
                                : it.status === "WORKER_REASON_MISSING" ? "bg-rose-600"
                                : "bg-slate-600",
                            ].join(" ")}>
                              {STATUS_LABEL[it.status]}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="p-2">
              {/* pagination — 공용 컴포넌트 */}
              <Pagination className="mt-3 px-1" page={page} totalPages={totalPages} total={viewItems.length} onPageChange={setPage} />
            </div>
          </div>
        </div>

        {/* Right detail */}
        <div className="min-w-0">
          <div className="flex h-full flex-col rounded-xl border border-slate-100 bg-white p-5">
            {!selected ? (
              <div className="rounded-xl border p-6 text-sm text-slate-500">좌측 목록에서 항목을 선택하세요.</div>
            ) : (
              <>
                {/* 상세 헤더 */}
                <div className="mb-3">
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-base font-semibold">상세 내용 조회</div>
                    <div className="text-xs text-slate-400">최근 업데이트: {new Date(selected.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="text-xs text-slate-400">※ 이슈를 확인하고, 직무지도원으로부터 사유를 확인합니다.</div>

                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* 직무지도원·현장명 + 상태 뱃지(옆으로 이동) */}
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 truncate text-lg font-semibold">
                          {selected.workerName}{" "}
                          <span className="text-slate-300 font-normal">·</span>{" "}
                          <span className="font-normal text-slate-700">{selected.siteName}</span>
                        </div>
                        <span className={[
                          "shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[11px] font-bold text-white",
                          selected.status === "ADMIN_RESOLVED" ? "bg-emerald-600"
                            : selected.status === "WORKER_REPLIED" ? "bg-sky-600"
                            : selected.status === "WORKER_REASON_MISSING" ? "bg-rose-600"
                            : "bg-slate-600",
                        ].join(" ")}>
                          {STATUS_LABEL[selected.status]}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-700">{fmtYmdDots(selected.workDate)}</div>

                      {/* 배지(목록과 동일 규칙/순서) */}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {detailBadges.map(({ key, type }) => (
                          <span
                            key={key}
                            className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ${ISSUE_STYLE[type].className}`}
                          >
                            {ISSUE_LABEL[type]}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 뱃지 자리 → 사유 등록 요청 버튼 */}
                    <div className="shrink-0">
                      {actions?.showRequestReason && (
                        <button
                          onClick={actionRequestReason}
                          className="whitespace-nowrap rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                          사유 등록 요청
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 급여 보호 게이트: 보정대기 안내 */}
                {selected.payrollPending ? (() => {
                  const thr = selected.seriousLateMin ?? 30;
                  const reasons: string[] = [];
                  if (selected.lateMinutes != null && selected.lateMinutes >= thr) reasons.push(`지각 ${selected.lateMinutes}분`);
                  if (selected.earlyLeaveMinutes != null && selected.earlyLeaveMinutes >= thr) reasons.push(`조퇴 ${selected.earlyLeaveMinutes}분`);
                  return (
                  <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-xs font-bold text-white">보정대기</span>
                      <span className="text-sm font-bold text-rose-700">
                        급여 산정 보류 — 심한 지각/조퇴({thr}분+){reasons.length ? `: ${reasons.join(" · ")}` : ""}
                      </span>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-4">
                      <p className="text-[13px] font-medium text-rose-700/90">
                        해당 일은 출퇴근 시간이 출근부에 등록되지 않습니다.(급여 시간 합산 제외로 해당일 급여 미지급)
                        <br />
                        직무지도원의 수정요청을 승인하면, 보정시각으로 확정됩니다.(해당일 급여에 반영)
                      </p>
                      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
                        {selected.correctionRequestedAt ? (
                          <span className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-white px-3 text-[13px] font-bold text-rose-600">
                            ✓ 보정요청됨 ({new Date(selected.correctionRequestedAt).toLocaleDateString()})
                          </span>
                        ) : selected.hasPendingEdit ? (
                          <span className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-amber-300 bg-amber-50 px-3 text-[13px] font-bold text-amber-700">
                            ⏳ 수정요청 제출됨 — 검토 후 승인하세요
                          </span>
                        ) : (
                          <button
                            onClick={actionRequestCorrection}
                            disabled={requestingCorrection}
                            className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg border border-rose-300 bg-white px-3 text-[13px] font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                          >
                            {requestingCorrection ? "요청 중…" : "직무지도원에게 시각 보정 요청"}
                          </button>
                        )}
                        <a
                          href="/manager/attendance-edit-requests"
                          className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-lg bg-rose-600 px-3 text-[13px] font-bold text-white hover:bg-rose-700"
                        >
                          출근부 수정요청 검토하기 →
                        </a>
                      </div>
                    </div>
                  </div>
                  );
                })() : null}

                {/* 퇴근 미실행: 매니저 표준시각 확정 폴백 */}
                {selected.missedClockOut ? (
                  <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">퇴근 미실행</span>
                      <span className="text-sm font-bold text-amber-800">직무지도원이 퇴근 버튼을 누르지 않은 날입니다.</span>
                    </div>
                    <p className="mt-2 text-[13px] font-medium text-amber-800/90">
                      직무지도원이 사유와 함께 퇴근을 처리하도록 안내해 주세요. 월말까지 퇴근 시간이 입력되지 않으면 담당자 책임 하, 아래에서 <b>표준 퇴근시각</b>으로 확정 가능합니다.
                      <span className="font-bold text-rose-600"> 만약 퇴근 시간이 입력되지 않으면 해당 일은 급여 산정에서 제외됩니다.</span>
                    </p>
                    <div className="mt-3">
                      <button
                        onClick={actionConfirmMissedClockOut}
                        disabled={confirmingMissed}
                        className="inline-flex items-center rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                      >
                        {confirmingMissed ? "확정 중…" : "표준 퇴근시각으로 확정"}
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* KPI(좁게) + 실제 출퇴근 결과(넓게) — 높이 동일(stretch) */}
                <div className="mb-3 grid gap-3 sm:grid-cols-[2fr_3fr]">
                  {/* KPI */}
                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100">
                    <div className="grid grid-cols-4 gap-1 text-sm">
                      <div>
                        <div className="text-xs text-slate-400">출근</div>
                        <div className="font-semibold">{fmtTime(selected.clockInAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">퇴근</div>
                        <div className="font-semibold">{fmtTime(selected.clockOutAt)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">기준거리</div>
                        <div className="font-semibold">{selected.rangeM ?? "-"}m</div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-400">거리(출근)</div>
                        <div className="font-semibold">{selected.startDistanceM ?? "-"}m</div>
                      </div>
                    </div>
                  </div>

                  {/* 실제 출퇴근 버튼 시각 + 지각(정상 출근 확인용). 출근부는 근무형태 고정시각 사용 */}
                  {(selected.actualClockInAt || selected.actualClockOutAt) ? (() => {
                    const expMin = getExpectedStartMin(selected);
                    const actMin = isoToLocalMin(selected.actualClockInAt);
                    const lateMin = expMin != null && actMin != null ? actMin - expMin : null;
                    return (
                      <div className="rounded-xl border border-sky-100 bg-sky-50 p-3">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <div className="text-xs font-black text-sky-700">실제 출퇴근 시간 등록 결과</div>
                          <span className="text-[11px] font-medium text-slate-400">출근부는 근무형태 표준시각으로 작성됩니다</span>
                        </div>
                        {lateMin != null && (
                          <div className="mt-1.5">
                            {lateMin >= 15 ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-black text-amber-600">{lateMin}분 지각</span>
                            ) : (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-black text-emerald-700">정시 출근</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })() : null}
                </div>

                {/* Actions (사유 등록 요청은 상단 헤더로 이동) — 없을 땐 렌더 안 함(빈 여백 제거) */}
                {actions?.showSupplementAndResolve && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    <button
                      onClick={actionRequestSupplement}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      보완 요청
                    </button>
                    <button
                      onClick={actionResolve}
                      className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      처리 완료
                    </button>
                  </div>
                )}

                {/* 타임라인 + 운영 메모 — 좌우 절반씩 한 줄 */}
                <div className="grid min-h-0 flex-1 gap-4 sm:grid-cols-2">
                {/* Timeline — 항목이 많으면 이 영역만 스크롤 */}
                <div className="flex min-h-0 flex-col">
                  <SectionTitle title="타임 라인" note="사유 요청/사유 등록/종결 처리 흐름" />
                  <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {selected.timeline.length === 0 ? (
                      <div className="rounded-xl border p-4 text-sm text-slate-500">타임라인 항목이 없습니다.</div>
                    ) : (
                      selected.timeline.map((ev) => (
                        <div key={ev.id} className="rounded-xl border p-3">
                          <div className="flex items-baseline justify-between">
                            <div className="text-sm font-semibold">{ev.label}</div>
                            <div className="text-xs text-slate-400">{new Date(ev.at).toLocaleString()}</div>
                          </div>
                          {ev.detail ? <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{ev.detail}</div> : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Memo */}
                <div className="flex min-h-0 flex-col">
                  <SectionTitle title="운영 메모" note="운영 관점에서 확인 사항/조치 내역을 기록합니다." />
                  <div className="mt-2 flex items-start gap-2">
                    <textarea
                      defaultValue={selected.adminMemo ?? ""}
                      onChange={(e) =>
                        updateSelected((it) => ({ ...it, adminMemo: e.target.value, updatedAt: new Date().toISOString() }))
                      }
                      className="h-14 flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-sky-100 focus:border-sky-400"
                      placeholder="운영 메모를 입력하세요"
                    />
                    <button
                      onClick={saveAdminMemo}
                      disabled={savingMemo}
                      className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      메모 저장
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">마지막 갱신: {new Date(selected.updatedAt).toLocaleString()}</div>
                </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* modal (prototype) */}
      {modal.type !== "NONE" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-7 shadow-2xl shadow-slate-950/20">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {modal.type === "REQUEST_REASON" ? "사유 등록 요청" : "보완 요청"}
              </div>
              <button className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setModal({ type: "NONE" })}>
                닫기
              </button>
            </div>
            <textarea
              value={modal.draft}
              onChange={(e) => setModal({ ...modal, draft: e.target.value } as any)}
              className="h-64 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-sky-100 focus:border-sky-400"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setModal({ type: "NONE" })}
              >
                취소
              </button>
              <button
                className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={async () => {
                  if (!selected) return;

                  if (modal.type === "REQUEST_REASON") {
                    const { ok, json } = await postJson<{ success: boolean; message?: string }>(
                      `/api/admin/attendance-inbox/${selected.id}/request-reason`,
                      { message: modal.draft }
                    ).catch(() => ({ ok: false, status: 0, json: null as any }));

                    // 중복 차단(이미 요청됨) 등 실패 시 서버 메시지 표시하고 중단(로컬 반영 안 함)
                    if (!ok) { alert(json?.message || "요청에 실패했습니다."); setModal({ type: "NONE" }); return; }

                    updateSelected((it) =>
                      pushTimeline(
                        { ...it, status: "WORKER_REASON_MISSING" },
                        "담당자 사유 등록 요청",
                        modal.draft
                      )
                    );
                  } else {
                    updateSelected((it) => pushTimeline(it, "담당자 보완 요청", modal.draft));
                  }

                  setModal({ type: "NONE" });
                }}
              >
                전송
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
