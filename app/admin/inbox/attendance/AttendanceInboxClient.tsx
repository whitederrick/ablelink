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

type IssueType = "OUT_OF_RANGE" | "TIME_ANOMALY" | "MISSING_CLOCK_IN" | "MISSING_CLOCK_OUT";
type IssueFilter = IssueType | "ALL";

type InboxStatus =
  | "ADMIN_UNCONFIRMED"
  | "COACH_CONFIRM_REQUESTED"
  | "COACH_REASON_MISSING"
  | "COACH_REPLIED"
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

  coachName: string;
  siteName: string;
  workDate: string; // YYYY-MM-DD

  issueTypes: IssueType[]; // 여러 개 가능
  status: InboxStatus;

  workType?: WorkType; // ✅ 근무형태
  expectedStartAt?: string; // ✅ 기준 출근시간 "HH:MM" (없으면 workType 기본값 사용)

  clockInAt?: string | null;
  clockOutAt?: string | null;

  rangeM?: number | null;
  startDistanceM?: number | null;
  endDistanceM?: number | null;

  coachReasonText?: string | null;
  adminMemo?: string | null;

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

const ISSUE_STYLE: Record<IssueType, { className: string }> = {
  OUT_OF_RANGE: { className: "bg-blue-600 text-white" }, // 기준 범위 이탈
  TIME_ANOMALY: { className: "bg-purple-900 text-white" }, // 출퇴근 시간이상
  MISSING_CLOCK_IN: { className: "bg-red-600 text-white" }, // 출근 기록 누락
  MISSING_CLOCK_OUT: { className: "bg-red-600 text-white" }, // 퇴근 기록 누락
};

const STATUS_LABEL: Record<InboxStatus, string> = {
  ADMIN_UNCONFIRMED: "담당자 미확인",
  COACH_CONFIRM_REQUESTED: "직무지도원 확인 요청",
  COACH_REASON_MISSING: "직무지도원 사유 미제출",
  COACH_REPLIED: "직무지도원 회신 완료",
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

        coachName: String(it.coachName ?? "-"),
        siteName: String(it.siteName ?? "-"),
        workDate: String(it.workDate),

        issueTypes: (it.issueTypes || []) as IssueType[],
        status: it.status as InboxStatus,

        workType: safeWorkType,
        expectedStartAt: it.expectedStartAt ?? undefined,

        clockInAt: it.clockInAt ?? null,
        clockOutAt: it.clockOutAt ?? null,

        rangeM: it.rangeM ?? null,
        startDistanceM: it.startDistanceM ?? null,
        endDistanceM: it.endDistanceM ?? null,

        coachReasonText: it.coachReasonText ?? null,
        adminMemo: it.adminMemo ?? null,

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

function buildPageWindow(totalPages: number, page: number, windowSize: number) {
  const half = Math.floor(windowSize / 2);
  let start = Math.max(1, page - half);
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);

  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);
  return pages;
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
      style={{
        padding: "5px 12px",
        borderRadius: 20,
        border: active
          ? "1px solid #3b82f6"
          : tone === "danger"
          ? "1px solid #fecaca"
          : "1px solid #e5e7eb",
        background: active ? "#3b82f6" : "#fff",
        color: active ? "#fff" : tone === "danger" ? "#dc2626" : "#374151",
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.15s",
        whiteSpace: "nowrap" as const,
      }}
    >
      {children}
    </button>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <div className="text-sm font-semibold">{title}</div>
      {note ? <div className="text-xs text-gray-400">※ {note}</div> : null}
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
    s === "ADMIN_UNCONFIRMED" || s === "COACH_CONFIRM_REQUESTED" || s === "COACH_REASON_MISSING";
  const showSupplementAndResolve = s === "COACH_REPLIED";
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

  // 기본: 처리완료는 숨김(필요 시 포함)
  const [statuses, setStatuses] = useState<InboxStatus[]>([
    "ADMIN_UNCONFIRMED",
    "COACH_CONFIRM_REQUESTED",
    "COACH_REASON_MISSING",
    "COACH_REPLIED",
  ]);

  /** data */
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** pagination */
  const pageSize = 10;
  const [page, setPage] = useState(1);

  const selected = useMemo(() => items.find((x) => x.id === selectedId) ?? null, [items, selectedId]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(items.length / pageSize)), [items.length]);
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page]);

  const pageWindow = useMemo(() => buildPageWindow(totalPages, page, 10), [totalPages, page]);

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

    // ✅ Step 3) 출퇴근 시간 이상(TIME_ANOMALY)
    const expectedStartMin = getExpectedStartMin(it);
    const actualInMin = isoToLocalMin(it.clockInAt);

    if (expectedStartMin != null && actualInMin != null) {
      const diff = actualInMin - expectedStartMin; // + 지각, - 조기
      const isLate = diff >= 1; // 1분이라도 늦으면
      const isTooEarly = diff <= -60; // 1시간 이상 일찍 출근하면
      if (isLate || isTooEarly) set.add("TIME_ANOMALY");
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
      <div className="mb-5 flex items-baseline gap-3">
        <div className="text-lg font-700 text-gray-900" style={{fontWeight:700,fontSize:18,color:"#111827",letterSpacing:"-0.3px"}}>근태 인박스</div>
        <div className="text-sm text-gray-400">※ 근태 관련 이슈를 파악하고, 근태 이슈 발생 사유를 확인합니다.</div>
      </div>

      {/* ===== Top Filter Bar (시안 구조) ===== */}
      <div className="mb-5 rounded-xl border border-gray-100 bg-white p-4">
        <div className="grid grid-cols-12 gap-3">
          {/* 통합 검색 */}
          <div className="col-span-12 lg:col-span-6">
            <label className="mb-1 block text-sm font-medium text-black/70">통합 검색</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="직무지도원명 / Site명 / 날짜(예: 2/3, 2026-02-03)"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
          </div>

          {/* 기간 조회 */}
          <div className="col-span-12 lg:col-span-6">
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium text-black/70">기간 조회</label>
              <span className="ml-auto text-xs text-black/50">
                선택: <span className="font-medium text-red-700">{periodLabel}</span>
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
                  className={cx("rounded-xl border px-3 py-2 text-sm", period !== "CUSTOM" ? "opacity-40" : "")}
                />
                <span className="text-black/60">~</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  disabled={period !== "CUSTOM"}
                  className={cx("rounded-xl border px-3 py-2 text-sm", period !== "CUSTOM" ? "opacity-40" : "")}
                />
              </div>
            </div>
          </div>

          {/* 이슈 필터 (단일) */}
          <div className="col-span-12 lg:col-span-6">
            <label className="mb-1 block text-sm font-medium text-black/70">이슈 필터(단일 선택)</label>
            <div className="flex flex-wrap gap-2">
              <Chip active={issue === "ALL"} onClick={() => setIssue("ALL")}>
                전체
              </Chip>
              <Chip active={issue === "OUT_OF_RANGE"} onClick={() => setIssue("OUT_OF_RANGE")} tone="danger">
                기준 범위 이탈
              </Chip>
              <Chip active={issue === "TIME_ANOMALY"} onClick={() => setIssue("TIME_ANOMALY")} tone="danger">
                출퇴근 시간 이상
              </Chip>
              <Chip active={issue === "MISSING_CLOCK_IN"} onClick={() => setIssue("MISSING_CLOCK_IN")} tone="danger">
                출근 기록 누락
              </Chip>
              <Chip active={issue === "MISSING_CLOCK_OUT"} onClick={() => setIssue("MISSING_CLOCK_OUT")} tone="danger">
                퇴근 기록 누락
              </Chip>
            </div>
          </div>

          {/* 처리 상태 (복수) */}
          <div className="col-span-12 lg:col-span-6">
            <label className="mb-1 block text-sm font-medium text-black/70">처리 상태(복수 선택)</label>
            <div className="flex flex-wrap gap-2">
              <Chip active={statuses.includes("ADMIN_UNCONFIRMED")} onClick={() => toggleStatus("ADMIN_UNCONFIRMED")}>
                {STATUS_LABEL.ADMIN_UNCONFIRMED}
              </Chip>
              <Chip
                active={statuses.includes("COACH_CONFIRM_REQUESTED")}
                onClick={() => toggleStatus("COACH_CONFIRM_REQUESTED")}
              >
                {STATUS_LABEL.COACH_CONFIRM_REQUESTED}
              </Chip>
              <Chip
                active={statuses.includes("COACH_REASON_MISSING")}
                onClick={() => toggleStatus("COACH_REASON_MISSING")}
              >
                {STATUS_LABEL.COACH_REASON_MISSING}
              </Chip>
              <Chip active={statuses.includes("COACH_REPLIED")} onClick={() => toggleStatus("COACH_REPLIED")}>
                {STATUS_LABEL.COACH_REPLIED}
              </Chip>
              <Chip active={statuses.includes("ADMIN_RESOLVED")} onClick={() => toggleStatus("ADMIN_RESOLVED")}>
                {STATUS_LABEL.ADMIN_RESOLVED}
              </Chip>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Main 2-pane ===== */}
      <div className="grid grid-cols-12 gap-4">
        {/* Left list */}
        <div className="col-span-12 lg:col-span-6 xl:col-span-6">
          <div className="rounded-xl border border-gray-100 bg-white">
            <div className="flex items-center justify-between border-b border-gray-50 px-4 py-3">
              <div className="flex items-baseline gap-2">
                <div className="text-sm font-semibold text-gray-800">목록 조회</div>
                <div className="text-sm text-blue-600 ml-1">{loading ? "불러오는 중…" : `(총 ${items.length}건)`}</div>
              </div>
              <div className="text-xs text-gray-400">정렬: 날짜 최신순</div>
            </div>

            <div className="p-2">
              <div className="space-y-1 p-2">
                {pageItems.length === 0 ? (
                  <div className="rounded-xl border p-6 text-sm text-black/60">조건에 해당하는 항목이 없습니다.</div>
                ) : (
                  pageItems.map((it) => {
                    const active = it.id === selectedId;
                    const { shown, rest, hasAny } = getListIssueBadges(it);

                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => setSelectedId(it.id)}
                        className={cx(
                          "w-full rounded-lg border border-gray-100 px-4 py-3 text-left transition",
                          active ? "border-blue-200 bg-blue-50" : "hover:bg-gray-50"
                        )}
                      >
                        <div className="mb-0 flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold">
                              {it.coachName} <span className="text-black/40 font-normal">·</span>{" "}
                              <span className="font-normal text-black/70">{it.siteName}</span>
                            </div>
                            <div className="mt-0.5 text-xs text-black/70">
                              {fmtYmdDots(it.workDate)} · 출근 {fmtTime(it.clockInAt)} / 퇴근 {fmtTime(it.clockOutAt)}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {hasAny ? (
                              <>
                                {shown.map((t) => (
                                  <span
                                    key={t}
                                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ISSUE_STYLE[t].className}`}
                                  >
                                    {ISSUE_LABEL[t]}
                                  </span>
                                ))}
                                {rest > 0 ? (
                                  <span className="inline-flex items-center rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold text-black/70">
                                    +{rest}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                          </div>

                          <span
                            className="
                              shrink-0 inline-flex
                              w-[138px] h-[35px]
                              items-center justify-center
                              rounded-xl bg-black
                              text-xs font-semibold text-white
                              text-center whitespace-pre-line leading-tight
                            "
                          >
                            {STATUS_LABEL[it.status]}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* pagination */}
              <div className="mt-3 flex items-center justify-between px-1">
                <div className="text-xs text-gray-400">
                  페이지 {page} / {totalPages}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-lg border px-2 py-1 text-xs hover:bg-black/5"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    이전
                  </button>
                  {pageWindow.map((p) => (
                    <button
                      key={p}
                      className={cx(
                        "rounded-lg border px-2 py-1 text-xs",
                        p === page ? "bg-blue-600 text-white border-blue-600" : "hover:bg-gray-50"
                      )}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  ))}
                  <button
                    className="rounded-lg border px-2 py-1 text-xs hover:bg-black/5"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                  >
                    다음
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right detail */}
        <div className="col-span-12 lg:col-span-6 xl:col-span-6">
          <div className="rounded-xl border border-gray-100 bg-white p-5">
            {!selected ? (
              <div className="rounded-xl border p-6 text-sm text-black/60">좌측 목록에서 항목을 선택하세요.</div>
            ) : (
              <>
                {/* 상세 헤더 */}
                <div className="mb-3">
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-base font-semibold">상세 내용 조회</div>
                    <div className="text-xs text-black/50">최근 업데이트: {new Date(selected.updatedAt).toLocaleString()}</div>
                  </div>
                  <div className="text-xs text-gray-400">※ 이슈를 확인하고, 직무지도원으로부터 사유를 확인합니다.</div>

                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-semibold">
                        {selected.coachName}{" "}
                        <span className="text-black/40 font-normal">·</span>{" "}
                        <span className="font-normal text-black/70">{selected.siteName}</span>
                      </div>
                      <div className="mt-1 text-sm text-black/70">{fmtYmdDots(selected.workDate)}</div>

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

                    <div className="shrink-0">
                      <div className="rounded-lg bg-gray-700 px-4 py-2 text-center text-xs font-semibold text-white">
                        {STATUS_LABEL[selected.status]}
                      </div>
                    </div>
                  </div>
                </div>

                {/* KPI */}
                <div className="mb-4 rounded-xl bg-gray-50 p-4 border border-gray-100">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-gray-400">출근</div>
                      <div className="font-semibold">{fmtTime(selected.clockInAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">퇴근</div>
                      <div className="font-semibold">{fmtTime(selected.clockOutAt)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">기준거리</div>
                      <div className="font-semibold">{selected.rangeM ?? "-"}m</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">거리(출근)</div>
                      <div className="font-semibold">{selected.startDistanceM ?? "-"}m</div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mb-4 flex flex-wrap gap-2">
                  {actions?.showRequestReason ? (
                    <button
                      onClick={actionRequestReason}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      사유 등록 요청
                    </button>
                  ) : null}

                  {actions?.showSupplementAndResolve ? (
                    <>
                      <button
                        onClick={actionRequestSupplement}
                        className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        보완 요청
                      </button>
                      <button
                        onClick={actionResolve}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                      >
                        처리 완료
                      </button>
                    </>
                  ) : null}
                </div>

                {/* Timeline */}
                <div className="mb-4">
                  <SectionTitle title="타임 라인" note="사유 요청/사유 등록/종결 처리 흐름" />
                  <div className="mt-2 space-y-2">
                    {selected.timeline.length === 0 ? (
                      <div className="rounded-xl border p-4 text-sm text-black/60">타임라인 항목이 없습니다.</div>
                    ) : (
                      selected.timeline.map((ev) => (
                        <div key={ev.id} className="rounded-xl border p-3">
                          <div className="flex items-baseline justify-between">
                            <div className="text-sm font-semibold">{ev.label}</div>
                            <div className="text-xs text-black/50">{new Date(ev.at).toLocaleString()}</div>
                          </div>
                          {ev.detail ? <div className="mt-1 text-sm text-black/70 whitespace-pre-wrap">{ev.detail}</div> : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Memo */}
                <div>
                  <SectionTitle title="운영 메모" note="운영 관점에서 확인 사항/조치 내역을 기록합니다." />
                  <div className="mt-2 flex items-start gap-2">
                    <textarea
                      defaultValue={selected.adminMemo ?? ""}
                      onChange={(e) =>
                        updateSelected((it) => ({ ...it, adminMemo: e.target.value, updatedAt: new Date().toISOString() }))
                      }
                      className="h-14 flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
                      placeholder="운영 메모를 입력하세요"
                    />
                    <button
                      onClick={saveAdminMemo}
                      disabled={savingMemo}
                      className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      메모 저장
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-black/50">마지막 갱신: {new Date(selected.updatedAt).toLocaleString()}</div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* modal (prototype) */}
      {modal.type !== "NONE" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">
                {modal.type === "REQUEST_REASON" ? "사유 등록 요청" : "보완 요청"}
              </div>
              <button className="text-sm text-black/60 hover:text-black" onClick={() => setModal({ type: "NONE" })}>
                닫기
              </button>
            </div>
            <textarea
              value={modal.draft}
              onChange={(e) => setModal({ ...modal, draft: e.target.value } as any)}
              className="h-64 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                onClick={() => setModal({ type: "NONE" })}
              >
                취소
              </button>
              <button
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                onClick={async () => {
                  if (!selected) return;

                  if (modal.type === "REQUEST_REASON") {
                    const { ok } = await postJson<{ success: boolean }>(
                      `/api/admin/attendance-inbox/${selected.id}/request-reason`,
                      { message: modal.draft }
                    ).catch(() => ({ ok: false, status: 0, json: null }));

                    updateSelected((it) =>
                      pushTimeline(
                        { ...it, status: "COACH_REASON_MISSING" },
                        "담당자 사유 등록 요청",
                        ok ? modal.draft : `${modal.draft}\n\n(서버 반영 실패: 로컬 반영)`
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
