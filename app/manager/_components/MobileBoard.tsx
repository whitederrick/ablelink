"use client";

// 매니저(에이전시 관리자) 모바일 전용 간판 화면.
// 데스크톱 콘솔은 정보 과밀이라 모바일에선 셸 대신 이 화면만 렌더(AdminShellClient).
// 구성(확정 스펙):
//   A 즉시 처리 — 출근부 수정 요청을 그 자리에서 승인/반려 (GPS는 I 정책상 블로킹 제외)
//   B 오늘 인지 — 오늘 근무/일지 미완료/운영 리스크(high)/근태 사후확인(GPS·누락)
//   C 마감 인지(처리는 PC) — 보고서 미제출 D-day, 배정 종료 임박
// 급여·계약·리포트·현장등록·매칭·통계 등은 데스크톱 전용(여기 미노출).

import { useCallback, useEffect, useState } from "react";
import { LogOut, RefreshCw, Monitor } from "lucide-react";

type SessionInfo = {
  role: "ADMIN" | "GOV" | "AGENCY" | string;
  loginId: string;
  agencyName?: string | null;
};

interface DashboardData {
  today: string;
  summary: {
    todayWorking: number; todayDone: number;
    logDoneCount: number; logPendingCount: number;
    unconfirmedCount: number; docPendingSubmit: number; docOverdue: number;
    endingIn5: number; endingIn10: number; unassignedSiteCount: number;
  };
  attendanceIssueList: Array<{
    id: string; workerName: string; siteName: string;
    workDate: string; issueTypes: string[]; createdAt: string;
  }>;
  docList: Array<{
    id: string; docType: string; docTypeLabel: string;
    workerName: string; siteName: string; dueAt: string;
    isOverdue: boolean; hasVersion: boolean;
  }>;
  assignmentAlerts: Array<{
    id: string; workerName: string; siteName: string;
    endDate: string | null; serviceStep: string; daysLeft: number | null;
  }>;
  riskAlerts: Array<{
    type: string; label: string; target: string; detail: string;
    severity: "high" | "medium" | "low";
  }>;
  todayList: Array<{
    id: string; workerName: string; siteName: string;
    clockIn: string | null; clockOut: string | null;
    isFinalClosed: boolean; isGpsModified: boolean;
    hasIssue: boolean; logStatus: "미작성" | "임시저장" | "완료";
  }>;
}

interface EditRequest {
  id: string;
  workerName: string;
  siteName: string;
  workDate: string;
  currentStart: string | null;
  currentEnd: string | null;
  proposedStart: string | null;
  proposedEnd: string | null;
  reason: string | null;
  status: string;
}

const LOG_CLS: Record<string, string> = {
  완료: "text-emerald-600", 임시저장: "text-amber-600", 미작성: "text-rose-600",
};

function SectionCard({ tag, tagCls, title, sub, count, children }: {
  tag: string; tagCls: string; title: string; sub?: string;
  count?: number; children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-950/[0.03]">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[11px] font-black ${tagCls}`}>{tag}</span>
        <h2 className="text-[15px] font-black text-slate-900">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="ml-auto rounded-full bg-rose-500 px-2 py-0.5 text-[11px] font-black text-white">{count}</span>
        )}
      </div>
      {sub && <p className="-mt-2 mb-3 text-[12px] font-semibold text-slate-400">{sub}</p>}
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-5 text-center text-[13px] font-semibold text-slate-300">{text}</p>;
}

export default function MobileBoard({
  session,
  onLoggedOut,
}: {
  session?: SessionInfo;
  onLoggedOut: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [editReqs, setEditReqs] = useState<EditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [acting, setActing] = useState<string | null>(null); // 처리 중인 요청 id
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [dRes, eRes] = await Promise.all([
        fetch("/api/admin/dashboard", { cache: "no-store" }),
        fetch("/api/admin/attendance-edit-requests", { cache: "no-store" }),
      ]);
      const dJson = await dRes.json();
      const eJson = await eRes.json();
      if (dJson.success) setData(dJson.data);
      if (eJson.success) {
        setEditReqs((eJson.requests as EditRequest[]).filter(r => r.status === "PENDING"));
      }
      setLastUpdated(new Date());
    } catch {
      // 네트워크 일시 오류는 조용히 — 다음 새로고침/폴링에서 수렴
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  async function actOnRequest(id: string, action: "approve" | "reject") {
    if (acting) return;
    if (action === "reject" && !confirm("이 수정 요청을 반려할까요?")) return;
    setActing(id);
    try {
      const res = await fetch(`/api/admin/attendance-edit-requests/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (json.success) {
        // 낙관적으로 목록에서 제거 + 대시보드 재동기화
        setEditReqs(prev => prev.filter(r => r.id !== id));
        load(true);
      } else {
        alert(json.message || "처리에 실패했습니다.");
        load(true); // 이미 처리됨(409) 등 서버 상태로 수렴
      }
    } catch {
      alert("네트워크 오류로 처리하지 못했습니다.");
    } finally {
      setActing(null);
    }
  }

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/manager/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    finally {
      onLoggedOut();
      window.location.href = "/manager/login";
    }
  }

  const d = data;
  const s = d?.summary;
  const todayFmt = d?.today
    ? `${d.today.slice(0, 4)}.${d.today.slice(5, 7)}.${d.today.slice(8, 10)} (${["일","월","화","수","목","금","토"][new Date(d.today).getDay()]})`
    : "";

  const gpsIssues = d?.attendanceIssueList.filter(i => i.issueTypes.includes("OUT_OF_RANGE")) ?? [];
  const timeIssues = d?.attendanceIssueList.filter(i =>
    i.issueTypes.includes("MISSING_CLOCK_IN") ||
    i.issueTypes.includes("MISSING_CLOCK_OUT") ||
    i.issueTypes.includes("TIME_ANOMALY")) ?? [];
  const highRisks = d?.riskAlerts.filter(r => r.severity === "high") ?? [];
  const overdueDocs = d?.docList.filter(r => r.isOverdue) ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-black text-slate-900">
              {session?.agencyName || "AbleLink"}
            </p>
            <p className="text-[11px] font-semibold text-slate-400">
              {todayFmt}{session?.loginId ? ` · ${session.loginId}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => load(true)}
              disabled={refreshing}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition active:scale-95 disabled:opacity-50"
              aria-label="새로고침"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            </button>
            <button
              onClick={logout}
              disabled={loggingOut}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition active:scale-95 disabled:opacity-50"
              aria-label="로그아웃"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-slate-900" />
          <span className="text-[13px] font-semibold text-slate-400">불러오는 중...</span>
        </div>
      ) : (
        <div className="space-y-3 px-4 py-4 pb-24">

          {/* ───── A. 즉시 처리 ───── */}
          <SectionCard
            tag="A" tagCls="bg-rose-100 text-rose-700"
            title="즉시 처리" sub="출근부 수정 요청 — 탭하여 바로 승인/반려"
            count={editReqs.length}
          >
            {editReqs.length === 0 ? (
              <Empty text="처리할 요청 없음" />
            ) : (
              <div className="space-y-2.5">
                {editReqs.map(r => (
                  <div key={r.id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[14px] font-black text-slate-900">{r.workerName}</p>
                      <p className="text-[11px] font-semibold text-slate-400">{r.workDate}</p>
                    </div>
                    <p className="mt-0.5 text-[12px] font-semibold text-slate-500">{r.siteName}</p>
                    <div className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[12px] font-semibold">
                      <div className="flex items-center gap-1.5 text-slate-600">
                        <span className="text-slate-400">현재</span>
                        <span>{r.currentStart || "-"} ~ {r.currentEnd || "-"}</span>
                        <span className="text-slate-300">→</span>
                        <span className="font-black text-sky-700">{r.proposedStart || "-"} ~ {r.proposedEnd || "-"}</span>
                      </div>
                      {r.reason && (
                        <p className="mt-1 text-[12px] font-medium text-slate-500">사유: {r.reason}</p>
                      )}
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <button
                        onClick={() => actOnRequest(r.id, "reject")}
                        disabled={acting === r.id}
                        className="rounded-xl border border-slate-200 bg-white py-2.5 text-[13px] font-black text-slate-500 transition active:scale-95 disabled:opacity-50"
                      >
                        반려
                      </button>
                      <button
                        onClick={() => actOnRequest(r.id, "approve")}
                        disabled={acting === r.id}
                        className="rounded-xl bg-slate-900 py-2.5 text-[13px] font-black text-white transition active:scale-95 disabled:opacity-50"
                      >
                        {acting === r.id ? "처리 중..." : "승인"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* ───── B. 오늘 인지 ───── */}
          <SectionCard
            tag="B" tagCls="bg-sky-100 text-sky-700"
            title="오늘 인지"
            sub={`근무 ${s?.todayWorking ?? 0}명 · 종료 ${s?.todayDone ?? 0}명`}
          >
            {/* 운영 리스크 (high) */}
            {highRisks.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {highRisks.map((a, i) => (
                  <div key={i} className="rounded-lg border-l-4 border-l-rose-500 bg-rose-50 p-2.5">
                    <span className="text-[12px] font-black text-rose-600">{a.label}</span>
                    <span className="ml-1.5 text-[12px] font-semibold text-slate-600">{a.detail}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 오늘 출근 현황 */}
            {!d?.todayList.length ? (
              <Empty text="오늘 출근 기록 없음" />
            ) : (
              <div className="divide-y divide-slate-50">
                {d.todayList.map(row => (
                  <div key={row.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[14px] font-black text-slate-900">{row.workerName}</span>
                      {row.hasIssue && (
                        <span className="flex-shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">이슈</span>
                      )}
                    </div>
                    <span className="flex-shrink-0 text-[12px] font-semibold text-slate-400">
                      {row.clockIn || "-"} ~ {row.clockOut || "-"}
                    </span>
                    <span className={`w-12 flex-shrink-0 text-right text-[12px] font-black ${LOG_CLS[row.logStatus] || "text-slate-400"}`}>
                      {row.logStatus}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 근태 사후 확인 요약 (일지 미완료 / GPS·누락) */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <StatChip label="일지 미완료" value={s?.logPendingCount ?? 0} urgent={(s?.logPendingCount ?? 0) > 0} />
              <StatChip label="범위 이탈" value={gpsIssues.length} urgent={false} />
              <StatChip label="출퇴근 누락" value={timeIssues.length} urgent={timeIssues.length > 0} />
            </div>
            <p className="mt-2 text-[11px] font-semibold text-slate-400">
              상세 검토·확정은 PC 콘솔에서 진행하세요.
            </p>
          </SectionCard>

          {/* ───── C. 마감 인지 (처리는 PC) ───── */}
          <SectionCard
            tag="C" tagCls="bg-amber-100 text-amber-700"
            title="마감 인지"
            sub="기한 임박 — 처리는 PC 콘솔에서"
            count={overdueDocs.length + (d?.assignmentAlerts.length ?? 0)}
          >
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[12px] font-black text-slate-500">보고서 미제출</p>
                {overdueDocs.length === 0 ? (
                  <p className="text-[13px] font-semibold text-slate-300">없음</p>
                ) : (
                  <div className="space-y-1">
                    {overdueDocs.slice(0, 6).map(r => (
                      <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg bg-rose-50/60 px-2.5 py-1.5">
                        <span className="truncate text-[12px] font-semibold text-slate-700">
                          <span className="font-black">{r.siteName}</span> · {r.workerName}
                        </span>
                        <span className="flex-shrink-0 text-[11px] font-black text-rose-600">{r.docTypeLabel}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-[12px] font-black text-slate-500">배정 종료 임박</p>
                {!d?.assignmentAlerts.length ? (
                  <p className="text-[13px] font-semibold text-slate-300">없음</p>
                ) : (
                  <div className="space-y-1">
                    {d.assignmentAlerts.slice(0, 6).map(a => (
                      <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-amber-50/60 px-2.5 py-1.5">
                        <span className="truncate text-[12px] font-semibold text-slate-700">
                          <span className="font-black">{a.workerName}</span> · {a.siteName}
                        </span>
                        <span className={`flex-shrink-0 text-[11px] font-black ${(a.daysLeft ?? 99) <= 3 ? "text-rose-600" : "text-amber-600"}`}>
                          D-{a.daysLeft}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          {/* PC 안내 */}
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-3 text-[12px] font-semibold text-slate-400">
            <Monitor className="h-4 w-4" aria-hidden="true" />
            급여·계약·문서·통계 등 전체 관리는 PC에서 이용하세요.
          </div>

          {lastUpdated && (
            <p className="text-center text-[11px] font-semibold text-slate-300">
              {lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, urgent }: { label: string; value: number; urgent: boolean }) {
  return (
    <div className={`rounded-xl border p-2 text-center ${urgent ? "border-rose-200 bg-rose-50" : "border-slate-100 bg-slate-50"}`}>
      <p className={`text-[18px] font-black leading-none ${urgent ? "text-rose-600" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-[10px] font-semibold leading-tight text-slate-500">{label}</p>
    </div>
  );
}
