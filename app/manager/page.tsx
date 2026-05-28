"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

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
    id: string; userName: string; siteName: string;
    workDate: string; issueTypes: string[]; createdAt: string;
  }>;
  docList: Array<{
    id: string; docType: string; docTypeLabel: string;
    coachName: string; siteName: string; dueAt: string;
    isOverdue: boolean; hasVersion: boolean;
  }>;
  assignmentAlerts: Array<{
    id: string; userName: string; siteName: string;
    endDate: string | null; serviceStep: string; daysLeft: number | null;
  }>;
  riskAlerts: Array<{
    type: string; label: string; target: string; detail: string;
    severity: "high" | "medium" | "low";
  }>;
  todayList: Array<{
    id: string; userName: string; siteName: string;
    clockIn: string | null; clockOut: string | null;
    isFinalClosed: boolean; isGpsModified: boolean;
    hasIssue: boolean; logStatus: "미작성" | "임시저장" | "완료";
  }>;
}

const SEVERITY_CLS: Record<string, { text: string; bg: string; border: string }> = {
  high:   { text: "text-rose-600",   bg: "bg-rose-50",   border: "border-l-rose-500" },
  medium: { text: "text-orange-600", bg: "bg-orange-50", border: "border-l-orange-500" },
  low:    { text: "text-slate-500",  bg: "bg-slate-50",  border: "border-l-slate-300" },
};
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

function Section({ title, sub, count, onMore, children }: {
  title: string; sub?: string; count?: number;
  onMore?: () => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-slate-900">{title}</h2>
            {count !== undefined && count > 0 && (
              <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-black text-white">{count}</span>
            )}
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
  const docPendingList = d?.docList.filter(r => !r.isOverdue) ?? [];
  const docOverdueList = d?.docList.filter(r => r.isOverdue) ?? [];

  const SUMMARY_CARDS = [
    { label: "오늘 근무",       value: s?.todayWorking ?? 0,        unit: "명", urgent: false, onClick: undefined as (() => void) | undefined },
    { label: "미확인 근태",     value: s?.unconfirmedCount ?? 0,    unit: "건", urgent: (s?.unconfirmedCount ?? 0) > 0, onClick: () => router.push("/manager/inbox/attendance") },
    { label: "보고서 제출 대기", value: s?.docPendingSubmit ?? 0,   unit: "건", urgent: false, onClick: () => router.push("/manager/documents") },
    { label: "보고서 미제출",   value: s?.docOverdue ?? 0,          unit: "건", urgent: (s?.docOverdue ?? 0) > 0, onClick: () => router.push("/manager/documents") },
    { label: "배정 종료 임박",  value: s?.endingIn5 ?? 0,           unit: "명", urgent: (s?.endingIn5 ?? 0) > 0, onClick: undefined, sub: `D-10: ${s?.endingIn10 ?? 0}명` },
    { label: "일지 미완료",     value: s?.logPendingCount ?? 0,     unit: "건", urgent: (s?.logPendingCount ?? 0) > 0, onClick: undefined, sub: `완료: ${s?.logDoneCount ?? 0}건` },
    { label: "미배정 Site",     value: s?.unassignedSiteCount ?? 0, unit: "건", urgent: (s?.unassignedSiteCount ?? 0) > 0, onClick: () => router.push("/manager/sites") },
  ];

  return (
    <div className="max-w-[1200px] space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-black text-slate-900">업무 현황 요약</h1>
          <p className="mt-0.5 text-sm font-semibold text-slate-400">{todayFmt}</p>
        </div>
        <button
          onClick={fetchDashboard}
          className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 active:scale-95"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트</span>
        </button>
      </div>

      {/* 요약 카드 7종 */}
      <div className="grid grid-cols-7 gap-2.5">
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

      {/* 메인 그리드 */}
      <div className="grid grid-cols-[1fr_360px] gap-4">

        {/* 좌측 */}
        <div className="space-y-4">

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
                  <span><span className="font-black">{item.userName}</span> · {item.siteName}</span>
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
                  <span><span className="font-black">{item.userName}</span> · {item.siteName}</span>
                  <span className="text-slate-400">{item.workDate}</span>
                </div>
              )}
            />
            <div className="border-t border-slate-100 pt-2.5">
              <button onClick={() => router.push("/manager/inbox/attendance")} className="text-xs font-black text-sky-600 transition hover:text-sky-700">
                → 근태 관리 바로가기
              </button>
            </div>
          </Section>

          {/* 보고서 제출 현황 */}
          <Section title="보고서 제출 현황" sub="직무지도원 문서 제출 현황" count={(s?.docPendingSubmit ?? 0) + (s?.docOverdue ?? 0)} onMore={() => router.push("/manager/documents")}>
            <ActionRow
              label="보고서 제출 대기"
              count={s?.docPendingSubmit ?? 0} urgent={false}
              onCountClick={() => setPopup(p => p === "doc_pending" ? null : "doc_pending")}
              showPopup={popup === "doc_pending"}
              popupItems={docPendingList}
              onPopupItemClick={() => router.push("/manager/documents")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.siteName}</span> · {item.coachName}</span>
                  <span className="text-amber-600">{item.docTypeLabel}</span>
                </div>
              )}
            />
            <ActionRow
              label="보고서 반려(수정 요청)"
              count={0} urgent={false}
              onCountClick={() => {}} showPopup={false} popupItems={[]}
              onPopupItemClick={() => {}} onPopupClose={() => {}} renderPopupItem={() => null}
            />
            <ActionRow
              label="보고서 미제출"
              count={s?.docOverdue ?? 0} urgent={(s?.docOverdue ?? 0) > 0}
              onCountClick={() => setPopup(p => p === "doc_overdue" ? null : "doc_overdue")}
              showPopup={popup === "doc_overdue"}
              popupItems={docOverdueList}
              onPopupItemClick={() => router.push("/manager/documents")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.siteName}</span> · {item.coachName}</span>
                  <span className="text-rose-600">{item.docTypeLabel}</span>
                </div>
              )}
            />
            <div className="border-t border-slate-100 pt-2.5">
              <button onClick={() => router.push("/manager/documents")} className="text-xs font-black text-sky-600 transition hover:text-sky-700">
                → 문서 관리 바로가기
              </button>
            </div>
          </Section>

          {/* 배정/계약 현황 */}
          <Section title="배정 / 계약 현황" sub="배정 / 계약 이슈 현황" count={s?.endingIn10} onMore={() => router.push("/manager/coaches")}>
            <ActionRow
              label="배정 종료 임박"
              count={s?.endingIn10 ?? 0} urgent={(s?.endingIn10 ?? 0) > 0}
              onCountClick={() => setPopup(p => p === "assign_ending" ? null : "assign_ending")}
              showPopup={popup === "assign_ending"}
              popupItems={d?.assignmentAlerts ?? []}
              onPopupItemClick={() => router.push("/manager/coaches")}
              onPopupClose={() => setPopup(null)}
              renderPopupItem={(item: any) => (
                <div className="flex justify-between">
                  <span><span className="font-black">{item.userName}</span> · {item.siteName}</span>
                  <span className={`font-black ${(item.daysLeft ?? 99) <= 3 ? "text-rose-600" : "text-amber-600"}`}>
                    D-{item.daysLeft}
                  </span>
                </div>
              )}
            />
            <ActionRow
              label="계약서 미등록"
              count={0} urgent={false}
              onCountClick={() => {}} showPopup={false} popupItems={[]}
              onPopupItemClick={() => {}} onPopupClose={() => {}} renderPopupItem={() => null}
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
            <div className="border-t border-slate-100 pt-2.5">
              <button onClick={() => router.push("/manager/coaches")} className="text-xs font-black text-sky-600 transition hover:text-sky-700">
                → 직무지도원 운영 바로가기
              </button>
            </div>
          </Section>
        </div>

        {/* 우측 */}
        <div className="space-y-4">

          {/* 운영 리스크 */}
          <Section title="운영 리스크 알림">
            {!d?.riskAlerts.length ? <EmptyRow text="리스크 알림 없음" /> : (
              <div className="space-y-1.5">
                {d.riskAlerts.map((alert, i) => {
                  const cls = SEVERITY_CLS[alert.severity] ?? SEVERITY_CLS.low;
                  return (
                    <div key={i} className={`rounded-lg border-l-4 p-2.5 ${cls.bg} ${cls.border}`}>
                      <span className={`text-xs font-black ${cls.text}`}>{alert.label}</span>
                      <span className="ml-1.5 text-xs font-semibold text-slate-600">{alert.detail}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          {/* 공지사항 */}
          <Section title="공지사항">
            {[
              "[공지] 관리자 시스템 기능 매뉴얼",
              "[안내] 직무지도원앱(APP) 서비스 기능 연계 안내",
              "[안내] 기능 고도화 일정 안나",
              "[안내] 직무지도원 보고서 장애인고용공단 전송 기능 안내",
            ].map((notice, i) => (
              <div key={i} className="border-b border-slate-50 py-2 text-sm font-semibold text-slate-700 last:border-b-0">
                {notice}
              </div>
            ))}
          </Section>

          {/* 오늘 출근 현황 */}
          <Section
            title="오늘 출근 현황"
            sub={`근무 ${s?.todayWorking ?? 0}명 / 종료 ${s?.todayDone ?? 0}명`}
            onMore={() => router.push("/manager/attendances")}
          >
            {!d?.todayList.length ? <EmptyRow text="오늘 출근 기록 없음" /> : (
              <div>
                {d.todayList.slice(0, 6).map(row => (
                  <div key={row.id} className="flex items-center justify-between border-b border-slate-50 py-2 last:border-b-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-black text-slate-900">{row.userName}</span>
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
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
