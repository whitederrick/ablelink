"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Lock } from "lucide-react";
import PageHeader from "./_components/PageHeader";
import Pagination from "./_components/Pagination";

interface DashboardData {
  today: string;
  summary: {
    todayWorking: number; todayDone: number;
    logDoneCount: number; logPendingCount: number;
    unconfirmedCount: number; docPendingSubmit: number; docOverdue: number;
    endingIn5: number; endingIn10: number; unassignedSiteCount: number;
    unassignedSiteList?: Array<{ id: string; companyName: string }>;
  };
  attendanceIssueList: Array<{
    id: string; workerName: string; siteName: string;
    workDate: string; issueTypes: string[]; createdAt: string;
  }>;
  docList: Array<{
    id: string; docType: string; docTypeLabel: string;
    workerName: string; siteName: string; dueAt: string;
    isOverdue: boolean; hasVersion: boolean; signStage: string;
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

const LOG_CLS: Record<string, string> = {
  완료: "text-emerald-600", 임시저장: "text-amber-600", 미작성: "text-rose-600",
};

function ActionRow({ label, count, urgent, onCountClick, showPopup, popupItems, onPopupItemClick, onPopupClose, renderPopupItem }: {
  label: string; count: number; urgent?: boolean;
  onCountClick: () => void; showPopup: boolean;
  popupItems: any[]; onPopupItemClick: (item: any) => void;
  onPopupClose: () => void; renderPopupItem: (item: any) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPopup) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onPopupClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPopup, onPopupClose]);

  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${urgent ? "bg-rose-500" : "bg-slate-300"}`} />
        <span className="text-sm font-semibold text-slate-700">{label}</span>
      </div>
      <div ref={ref} className="relative">
        <button
          onClick={count > 0 ? onCountClick : undefined}
          className={`rounded-full px-3 py-1 text-sm font-black transition ${
            count > 0
              ? urgent
                ? "bg-rose-50 text-rose-600 hover:bg-rose-100"
                : "bg-amber-50 text-amber-600 hover:bg-amber-100"
              : "bg-slate-50 text-slate-400"
          }`}
          style={{ cursor: count > 0 ? "pointer" : "default" }}
        >
          {count}건
        </button>
        {showPopup && count > 0 && (
          <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[340px] max-h-[280px] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-950/10">
            <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-semibold text-slate-400">
              총 {popupItems.length}건 · 클릭하면 상세로 이동
            </div>
            {popupItems.map((item, i) => (
              <button
                key={i}
                onClick={() => { onPopupItemClick(item); onPopupClose(); }}
                className="w-full border-b border-slate-50 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50 last:border-b-0"
              >
                {renderPopupItem(item)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, sub, titleRight, count, onMore, children }: {
  title: string; sub?: string; titleRight?: React.ReactNode; count?: number;
  onMore?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-black text-slate-900">{title}</h2>
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white">{count}</span>
            )}
            {titleRight}
          </div>
          {sub && <p className="mt-0.5 text-[11px] font-semibold text-slate-400">{sub}</p>}
        </div>
        {onMore && (
          <button onClick={onMore} className="text-xs font-black text-sky-600 transition hover:text-sky-700">
            더 보기 +
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm font-semibold text-slate-300">{text}</p>;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [popup, setPopup] = useState<null | "attendance_gps" | "attendance_time" | "doc_pending" | "doc_overdue" | "assign_ending" | "unassigned_site">(null);
  // 하단 3개 목록 페이지네이션(5개씩)
  const [riskPage, setRiskPage]     = useState(1);
  const [todayPage, setTodayPage]   = useState(1);
  const [noticePage, setNoticePage] = useState(1);
  const [pendingEditReqs, setPendingEditReqs] = useState(0);
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; body: string; type: string; createdAt: string; read?: boolean }[]>([]);
  // 훈련생 진척도 요약(기존 리포트 API 재사용, 클라 집계). 플랜 잠금 시 reportLocked.
  const [report, setReport] = useState<{ total: number; training: number; avgLogRate: number; avgScore: number | null } | null>(null);
  const [reportLocked, setReportLocked] = useState(false);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (json.success) { setData(json.data); setLastUpdated(new Date()); }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const t = setInterval(fetchDashboard, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchDashboard]);

  useEffect(() => {
    fetch("/api/admin/attendance-edit-requests")
      .then(r => r.json())
      .then(d => { if (d.success) setPendingEditReqs(d.requests.filter((r: any) => r.status === "PENDING").length); })
      .catch(() => {});
    fetch("/api/admin/announcements")
      .then(r => r.json())
      .then(d => { if (d.success) setAnnouncements(d.announcements); })
      .catch(() => {});
    // 이번 달 진척도 요약. 403=플랜 미달 → 잠금 표시.
    fetch("/api/admin/trainee-report")
      .then(async r => ({ status: r.status, json: await r.json() }))
      .then(({ status, json }) => {
        if (status === 403) { setReportLocked(true); return; }
        if (!json.success) return;
        const rows: any[] = json.data ?? [];
        const total = rows.length;
        const training = rows.filter(r => r.status === "TRAINING").length;
        const avgLogRate = total > 0 ? Math.round(rows.reduce((s, r) => s + r.logRate, 0) / total) : 0;
        const scored = rows.filter(r => r.avgScore !== null);
        const avgScore = scored.length > 0
          ? Math.round(scored.reduce((s, r) => s + r.avgScore, 0) / scored.length * 10) / 10
          : null;
        setReport({ total, training, avgLogRate, avgScore });
      })
      .catch(() => {});
  }, []);

  if (loading) return (
    <div className="flex min-h-[400px] flex-col items-center justify-center gap-3">
      <div className="h-7 w-7 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-slate-950" />
      <span className="text-sm font-semibold text-slate-400">로딩 중...</span>
    </div>
  );

  const d = data;
  const s = d?.summary;
  const todayFmt = d?.today
    ? `${d.today.slice(0,4)}년 ${Number(d.today.slice(5,7))}월 ${Number(d.today.slice(8,10))}일 (${["일","월","화","수","목","금","토"][new Date(d.today).getDay()]})`
    : "";

  const gpsIssues = d?.attendanceIssueList.filter(i => i.issueTypes.includes("OUT_OF_RANGE")) ?? [];
  const timeIssues = d?.attendanceIssueList.filter(i => i.issueTypes.includes("MISSING_CLOCK_IN") || i.issueTypes.includes("MISSING_CLOCK_OUT") || i.issueTypes.includes("TIME_ANOMALY")) ?? [];
  const docPendingList = d?.docList.filter(r => r.signStage === "SUBMITTED") ?? [];   // 확정 대기
  const docOverdueList = d?.docList.filter(r => r.signStage === "CONFIRMED") ?? [];   // 서명 대기

  // 정렬: daily(매일 챙겨야 하는 것)를 앞, 기간·마감성(보고서·배정 종료)을 뒤로.
  const SUMMARY_CARDS = [
    // ── daily ──
    { label: "오늘 근무",       value: s?.todayWorking ?? 0,        unit: "명", urgent: false, onClick: undefined as (() => void) | undefined },
    { label: "미확인 근태",     value: s?.unconfirmedCount ?? 0,    unit: "건", urgent: (s?.unconfirmedCount ?? 0) > 0, onClick: () => router.push("/manager/inbox/attendance") },
    { label: "출근부 수정 요청", value: pendingEditReqs,             unit: "건", urgent: pendingEditReqs > 0, onClick: () => router.push("/manager/attendance-edit-requests") },
    { label: "일지 미완료",     value: s?.logPendingCount ?? 0,     unit: "건", urgent: (s?.logPendingCount ?? 0) > 0, onClick: undefined, sub: `완료: ${s?.logDoneCount ?? 0}건` },
    // ── 기간·마감성 ──
    { label: "문서 확정 대기", value: s?.docPendingSubmit ?? 0,    unit: "건", urgent: (s?.docPendingSubmit ?? 0) > 0, onClick: () => router.push("/manager/documents") },
    { label: "문서 서명 대기", value: s?.docOverdue ?? 0,          unit: "건", urgent: false, onClick: () => router.push("/manager/documents") },
    { label: "배정 종료 임박",  value: s?.endingIn5 ?? 0,           unit: "명", urgent: (s?.endingIn5 ?? 0) > 0, onClick: undefined, sub: `D-10: ${s?.endingIn10 ?? 0}명` },
    { label: "미배정 Site",     value: s?.unassignedSiteCount ?? 0, unit: "건", urgent: (s?.unassignedSiteCount ?? 0) > 0, onClick: () => router.push("/manager/sites") },
  ];

  const reportMonth = d?.today ? Number(d.today.slice(5, 7)) : new Date().getMonth() + 1;

  // 하단 3개 목록 페이지네이션(5개씩)
  const PAGE = 5;
  const todayAll  = d?.todayList ?? [];
  const riskAll   = d?.riskAlerts ?? [];
  const todayPages  = Math.max(1, Math.ceil(todayAll.length / PAGE));
  const riskPages   = Math.max(1, Math.ceil(riskAll.length / PAGE));
  const noticePages = Math.max(1, Math.ceil(announcements.length / PAGE));
  const todaySlice  = todayAll.slice((todayPage - 1) * PAGE, todayPage * PAGE);
  const riskSlice   = riskAll.slice((riskPage - 1) * PAGE, riskPage * PAGE);
  const noticeSlice = announcements.slice((noticePage - 1) * PAGE, noticePage * PAGE);

  return (
    <div className="max-w-[1200px] space-y-4">
      {/* 헤더 */}
      <PageHeader
        title="통합 운영 대시보드"
        sub={todayFmt}
        actions={
          <button
            onClick={fetchDashboard}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트</span>
          </button>
        }
      />

      {/* 요약 카드 — daily(앞)/기간성(뒤). 반응형: 모바일 2열 → 데스크톱 8열 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
        {SUMMARY_CARDS.map((card, i) => (
          <button
            key={i}
            onClick={card.onClick}
            disabled={!card.onClick}
            className={`rounded-2xl border p-3 text-center transition disabled:cursor-default ${
              card.urgent
                ? "border-rose-200 bg-rose-50 hover:bg-rose-100"
                : "border-slate-100 bg-white hover:bg-slate-50"
            }`}
          >
            <p className="mb-1.5 text-[11px] font-semibold leading-tight text-slate-500">{card.label}</p>
            <p className={`text-2xl font-black leading-none ${card.urgent ? "text-rose-600" : "text-slate-900"}`}>
              {card.value}
              <span className="ml-0.5 text-xs font-semibold text-slate-400">{card.unit}</span>
            </p>
            {"sub" in card && card.sub && (
              <p className="mt-1 text-[10px] font-semibold text-slate-400">{card.sub}</p>
            )}
          </button>
        ))}
      </div>

      {/* 1행: 액션 섹션 가로 3열 — 근태 / 문서 / 배정·계약 */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">

          {/* 근태 현황 */}
          <Section title="근태 현황" sub="근무 중 직무지도원 근태 현황" count={s?.unconfirmedCount} onMore={() => router.push("/manager/inbox/attendance")}>
            <ActionRow
              label="출퇴근 기록 누락"
              count={timeIssues.length} urgent={timeIssues.length > 0}
              onCountClick={() => setPopup(p => p === "attendance_time" ? null : "attendance_time")}
              showPopup={popup === "attendance_time"}
              popupItems={timeIssues}
              onPopupItemClick={() => router.push("/manager/inbox/attendance")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.workerName}</span> · {item.siteName}</span>
                  <span className="text-slate-400">{item.workDate}</span>
                </div>
              )}
            />
            <ActionRow
              label="근무지 기준 범위 이탈"
              count={gpsIssues.length} urgent={false}
              onCountClick={() => setPopup(p => p === "attendance_gps" ? null : "attendance_gps")}
              showPopup={popup === "attendance_gps"}
              popupItems={gpsIssues}
              onPopupItemClick={() => router.push("/manager/inbox/attendance")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.workerName}</span> · {item.siteName}</span>
                  <span className="text-slate-400">{item.workDate}</span>
                </div>
              )}
            />
          </Section>

          {/* 제출 문서 현황 */}
          <Section title="제출 문서 현황" sub="직무지도원이 제출한 문서 확정·서명 대기" count={(s?.docPendingSubmit ?? 0) + (s?.docOverdue ?? 0)} onMore={() => router.push("/manager/documents")}>
            <ActionRow
              label="확정 대기"
              count={s?.docPendingSubmit ?? 0} urgent={(s?.docPendingSubmit ?? 0) > 0}
              onCountClick={() => setPopup(p => p === "doc_pending" ? null : "doc_pending")}
              showPopup={popup === "doc_pending"}
              popupItems={docPendingList}
              onPopupItemClick={() => router.push("/manager/documents")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.siteName}</span> · {item.workerName}</span>
                  <span className="text-amber-600">{item.docTypeLabel}</span>
                </div>
              )}
            />
            <ActionRow
              label="서명 대기"
              count={s?.docOverdue ?? 0} urgent={false}
              onCountClick={() => setPopup(p => p === "doc_overdue" ? null : "doc_overdue")}
              showPopup={popup === "doc_overdue"}
              popupItems={docOverdueList}
              onPopupItemClick={() => router.push("/manager/documents")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.siteName}</span> · {item.workerName}</span>
                  <span className="text-rose-600">{item.docTypeLabel}</span>
                </div>
              )}
            />
          </Section>

          {/* 배정/계약 현황 */}
          <Section title="배정 / 계약 현황" sub="배정 / 계약 이슈 현황" count={s?.endingIn10} onMore={() => router.push("/manager/workers")}>
            <ActionRow
              label="배정 종료 임박"
              count={s?.endingIn10 ?? 0} urgent={(s?.endingIn10 ?? 0) > 0}
              onCountClick={() => setPopup(p => p === "assign_ending" ? null : "assign_ending")}
              showPopup={popup === "assign_ending"}
              popupItems={d?.assignmentAlerts ?? []}
              onPopupItemClick={() => router.push("/manager/workers")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.workerName}</span> · {item.siteName}</span>
                  <span className={`font-black ${(item.daysLeft ?? 99) <= 3 ? "text-rose-600" : "text-amber-600"}`}>
                    D-{item.daysLeft}
                  </span>
                </div>
              )}
            />
            <ActionRow
              label="직무지도원 미배정 Site"
              count={s?.unassignedSiteCount ?? 0} urgent={false}
              onCountClick={() => setPopup(p => p === "unassigned_site" ? null : "unassigned_site")}
              showPopup={popup === "unassigned_site"}
              popupItems={d?.summary?.unassignedSiteList ?? []}
              onPopupItemClick={() => router.push("/manager/sites")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex items-center gap-2">
                  <span className="font-black">{item.companyName}</span>
                  <span className="text-slate-400">배정 없음</span>
                </div>
              )}
            />
          </Section>
      </div>

      {/* 2행: 오늘 출근 현황 · 운영 리스크 · 공지사항 가로 3열 (출근↔리스크 위치 교체) */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">

          {/* 오늘 출근 현황 */}
          <Section
            title="오늘 출근 현황"
            titleRight={
              <span className="text-[11px] font-semibold text-slate-400">
                근무 {s?.todayWorking ?? 0}명 / 종료 {s?.todayDone ?? 0}명
              </span>
            }
            onMore={() => router.push("/manager/attendances")}
          >
            {todayAll.length === 0 ? <EmptyRow text="오늘 출근 기록 없음" /> : (
              <>
                <div>
                  {todaySlice.map(row => (
                    <div key={row.id} className="flex items-center justify-between border-b border-slate-50 py-2 last:border-b-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-black text-slate-900">{row.workerName}</span>
                        {row.hasIssue && (
                          <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-black text-rose-600">이슈</span>
                        )}
                      </div>
                      <span className="text-xs font-semibold text-slate-400">{row.clockIn || "-"} ~ {row.clockOut || "-"}</span>
                      <span className={`text-xs font-black ${LOG_CLS[row.logStatus] || "text-slate-400"}`}>
                        {row.logStatus}
                      </span>
                    </div>
                  ))}
                </div>
                {todayPages > 1 && (
                  <Pagination className="mt-3" page={todayPage} totalPages={todayPages} total={todayAll.length} onPageChange={setTodayPage} />
                )}
              </>
            )}
          </Section>

          {/* 운영 리스크 — 단순 목록 */}
          <Section title="운영 리스크 알림" count={riskAll.length}>
            {riskAll.length === 0 ? <EmptyRow text="리스크 알림 없음" /> : (
              <>
                <div>
                  {riskSlice.map((alert, i) => (
                    <div key={i} className="flex items-center gap-2 border-b border-slate-50 py-2 last:border-b-0">
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${alert.severity === "high" ? "bg-rose-500" : alert.severity === "medium" ? "bg-amber-500" : "bg-slate-300"}`} />
                      <span className="text-sm font-bold text-slate-700">{alert.label}</span>
                      <span className="truncate text-xs font-semibold text-slate-400">{alert.detail}</span>
                    </div>
                  ))}
                </div>
                {riskPages > 1 && (
                  <Pagination className="mt-3" page={riskPage} totalPages={riskPages} total={riskAll.length} onPageChange={setRiskPage} />
                )}
              </>
            )}
          </Section>

          {/* 시스템 공지사항 — 운영자 시스템 공지(미확인 우선) */}
          <Section
            title="시스템 공지사항"
            count={announcements.filter(a => a.read === false).length}
            onMore={() => router.push("/manager/system-notices")}
          >
            {announcements.length === 0 ? (
              <EmptyRow text="등록된 공지가 없습니다" />
            ) : (
              <>
                {noticeSlice.map(a => (
                  <button key={a.id} onClick={() => router.push("/manager/system-notices")}
                    className="block w-full border-b border-slate-50 py-2 text-left last:border-b-0 transition hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${a.read === false ? "font-black text-slate-900" : "font-semibold text-slate-700"}`}>
                        <span className={`mr-1 ${a.type === "URGENT" ? "text-rose-600" : a.type === "MAINTENANCE" ? "text-amber-600" : "text-sky-600"}`}>
                          [{a.type === "URGENT" ? "긴급" : a.type === "MAINTENANCE" ? "점검" : "공지"}]
                        </span>
                        {a.title}
                        {a.read === false && <span className="ml-1.5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-black text-white">미확인</span>}
                      </p>
                      <span className="flex-shrink-0 text-[10px] font-semibold text-slate-300">{a.createdAt.slice(0, 10)}</span>
                    </div>
                  </button>
                ))}
                {noticePages > 1 && (
                  <Pagination className="mt-3" page={noticePage} totalPages={noticePages} total={announcements.length} onPageChange={setNoticePage} />
                )}
              </>
            )}
          </Section>
      </div>

      {/* 하단: 훈련생 진척도 리포트 요약 — 모니터링 성격. 더 보기 → /manager/reports */}
      <Section
        title="훈련생 진척도 리포트"
        sub={`${reportMonth}월 기준 요약`}
        onMore={reportLocked ? undefined : () => router.push("/manager/reports")}
      >
        {reportLocked ? (
          <div className="flex items-center gap-2 py-3 text-sm font-semibold text-slate-400">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            STANDARD 플랜 이상에서 훈련생 진척도를 확인할 수 있습니다.
          </div>
        ) : !report ? (
          <EmptyRow text="불러오는 중..." />
        ) : (
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-1 py-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-black leading-none text-slate-900">{report.total}<span className="ml-0.5 text-[11px] font-semibold text-slate-400">명</span></span>
              <span className="text-[11px] font-semibold text-slate-500">전체 훈련생</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-black leading-none text-sky-600">{report.training}<span className="ml-0.5 text-[11px] font-semibold text-slate-400">명</span></span>
              <span className="text-[11px] font-semibold text-slate-500">훈련 중</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-lg font-black leading-none ${report.avgLogRate >= 80 ? "text-emerald-600" : report.avgLogRate >= 60 ? "text-amber-500" : "text-rose-500"}`}>{report.avgLogRate}<span className="ml-0.5 text-[11px] font-semibold text-slate-400">%</span></span>
              <span className="text-[11px] font-semibold text-slate-500">평균 일지 작성률</span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-lg font-black leading-none ${report.avgScore === null ? "text-slate-300" : report.avgScore >= 4 ? "text-emerald-600" : report.avgScore >= 3 ? "text-sky-600" : "text-amber-500"}`}>{report.avgScore ?? "-"}<span className="ml-0.5 text-[11px] font-semibold text-slate-400">/5</span></span>
              <span className="text-[11px] font-semibold text-slate-500">평균 수행 점수</span>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
