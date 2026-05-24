"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronLeft,
  CircleDollarSign,
  FileText,
  Home,
  MapPin,
  PenLine,
  RefreshCw,
} from "lucide-react";

type Tab = "history" | "payroll";

interface HistoryItem {
  id: string; workDate: string; siteName: string;
  serviceStep: string | null;
  startTime: string | null; endTime: string | null;
  workedMinutes: number;
  isFinalClosed: boolean; isGpsModified: boolean;
  logStatus: "NONE" | "DRAFT" | "DONE";
  hasIssue: boolean; issueTypes: string[];
}
interface HistoryStats { total: number; workedDays: number; totalMinutes: number; issueCount: number; }

interface PayrollItem {
  id: string; runId: string; yearMonth: string; agencyName: string;
  finalizedAt: string | null;
  grossPay: number; totalDeduction: number; netPay: number;
  workedDays: number; workedMinutes: number; breakdown: any;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function defaultYM() {
  const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function fmtTime(iso: string | null) {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fmtMin(m: number) {
  if (!m) return "-";
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
function comma(n: number) { return Math.round(n).toLocaleString("ko-KR"); }

const stepLabel: Record<string, string> = {
  PRE_TRAINING: "사전훈련", FIELD_TRAINING: "현장훈련", ADAPTATION: "적응지도",
};
const logBadge: Record<string, { classes: string; label: string }> = {
  NONE:  { classes: "bg-slate-100 text-slate-400",    label: "미작성" },
  DRAFT: { classes: "bg-amber-100 text-amber-600",    label: "임시저장" },
  DONE:  { classes: "bg-emerald-100 text-emerald-600", label: "완료" },
};
const payTypeLabel: Record<string, string> = { MONTHLY: "월급", DAILY: "일급", HOURLY: "시급" };

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

export default function HistoryPage() {
  const router = useRouter();
  const [tab, setTab]             = useState<Tab>("history");
  const [yearMonth, setYearMonth] = useState(defaultYM());
  const [items,     setItems]     = useState<HistoryItem[]>([]);
  const [stats,     setStats]     = useState<HistoryStats | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [payItems,    setPayItems]    = useState<PayrollItem[]>([]);
  const [loadingPay,  setLoadingPay]  = useState(false);
  const [selectedPay, setSelectedPay] = useState<PayrollItem | null>(null);

  async function loadHistory() {
    setLoading(true);
    try {
      const res = await fetch(`/api/worker/history?yearMonth=${yearMonth}`);
      const d = await res.json();
      if (d.success) { setItems(d.items); setStats(d.stats); }
    } finally { setLoading(false); }
  }

  async function loadPayroll() {
    setLoadingPay(true);
    try {
      const res = await fetch("/api/worker/payroll");
      const d = await res.json();
      if (d.success) setPayItems(d.items);
    } finally { setLoadingPay(false); }
  }

  useEffect(() => {
    if (tab === "history") loadHistory();
    else loadPayroll();
  }, [tab]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [yearMonth]);

  // ── 급여명세 상세
  if (selectedPay) {
    const b = selectedPay.breakdown as any;
    return (
      <div className="min-h-dvh bg-slate-50">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => setSelectedPay(null)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-black text-slate-900">{selectedPay.yearMonth} 급여명세</h1>
          <div className="w-9" />
        </header>

        <div className="mx-auto max-w-md space-y-4 p-4">
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            {[
              { label: "소속 에이전시", value: selectedPay.agencyName },
              { label: "지급 기간",    value: selectedPay.yearMonth },
              { label: "확정일",      value: selectedPay.finalizedAt ? new Date(selectedPay.finalizedAt).toLocaleDateString("ko-KR") : "-" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between border-b border-slate-50 py-2.5 last:border-0">
                <span className="text-sm font-semibold text-slate-400">{label}</span>
                <span className="text-sm font-bold text-slate-900">{value}</span>
              </div>
            ))}
          </div>

          <p className="text-xs font-black uppercase tracking-wide text-slate-400">근무 현황</p>
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            {[
              { label: "근무 일수",     value: `${selectedPay.workedDays}일` },
              { label: "총 근무 시간",  value: fmtMin(selectedPay.workedMinutes) },
              ...(b?.payType ? [{ label: "급여 유형", value: payTypeLabel[b.payType] || b.payType }] : []),
              ...(b?.hourlyRate ? [{ label: "시급", value: `${comma(b.hourlyRate)}원` }] : []),
              ...(b?.dailyRate  ? [{ label: "일급", value: `${comma(b.dailyRate)}원` }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between border-b border-slate-50 py-2.5 last:border-0">
                <span className="text-sm font-semibold text-slate-400">{label}</span>
                <span className="text-sm font-bold text-slate-900">{value}</span>
              </div>
            ))}
          </div>

          <p className="text-xs font-black uppercase tracking-wide text-slate-400">지급 내역</p>
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <div className="flex items-center justify-between py-2">
              <span className="text-sm font-semibold text-slate-500">지급액</span>
              <span className="text-sm font-bold text-sky-600">{comma(selectedPay.grossPay)}원</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm font-semibold text-slate-500">공제액 (사업소득세 3.3%)</span>
              <span className="text-sm font-bold text-rose-500">-{comma(selectedPay.totalDeduction)}원</span>
            </div>
            <div className="my-2 border-t border-slate-900" />
            <div className="flex items-center justify-between py-2">
              <span className="text-base font-black text-slate-900">실지급액</span>
              <span className="text-xl font-black text-emerald-600">{comma(selectedPay.netPay)}원</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* 헤더 */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-black text-slate-900">히스토리</h1>
        <div className="w-9" />
      </header>

      {/* 탭 */}
      <div className="flex border-b border-slate-100 bg-white">
        {[
          { id: "history" as Tab, label: "근무 히스토리" },
          { id: "payroll" as Tab, label: "급여명세" },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-3.5 text-sm font-black transition border-b-2 ${
              tab === id
                ? "border-slate-950 text-slate-950"
                : "border-transparent text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── 히스토리 탭 ── */}
      {tab === "history" && (
        <div className="mx-auto max-w-md px-4 pb-28 pt-4 space-y-4">
          {/* 월 선택 */}
          <div className="flex gap-2">
            <input
              type="month"
              value={yearMonth}
              onChange={e => setYearMonth(e.target.value)}
              className="h-11 flex-1 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            />
            <button
              onClick={loadHistory}
              className="flex h-11 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600 transition active:scale-95"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* 통계 */}
          {stats && (
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { label: "근무 일수",   value: `${stats.workedDays}일`,     color: "text-sky-600" },
                { label: "총 근무 시간", value: fmtMin(stats.totalMinutes), color: "text-emerald-600" },
                { label: "전체 기록",   value: `${stats.total}건`,         color: "text-slate-700" },
                { label: "이슈",       value: `${stats.issueCount}건`,     color: stats.issueCount > 0 ? "text-rose-500" : "text-slate-300" },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-white p-4 text-center shadow-sm">
                  <p className={`mb-1 text-xl font-black ${color}`}>{value}</p>
                  <p className="text-xs font-semibold text-slate-400">{label}</p>
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-sky-500" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-3xl border border-slate-100 bg-white py-12 text-center">
              <p className="text-sm font-semibold text-slate-400">해당 월에 근무 기록이 없습니다.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map(item => (
                <div key={item.id} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900">{item.workDate}</span>
                      {item.serviceStep && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                          {stepLabel[item.serviceStep] ?? item.serviceStep}
                        </span>
                      )}
                    </div>
                    <span className={`rounded-lg px-2.5 py-1 text-[11px] font-black ${logBadge[item.logStatus].classes}`}>
                      {logBadge[item.logStatus].label}
                    </span>
                  </div>

                  <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-slate-400">
                    <MapPin className="h-3 w-3" />
                    {item.siteName}
                  </p>

                  <div className="flex gap-4 text-xs text-slate-600">
                    <span>출근 <strong>{fmtTime(item.startTime)}</strong></span>
                    <span>퇴근 <strong>{fmtTime(item.endTime)}</strong></span>
                    {item.workedMinutes > 0 && <span className="text-slate-400">{fmtMin(item.workedMinutes)}</span>}
                  </div>

                  {(item.isGpsModified || item.hasIssue) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {item.isGpsModified && (
                        <span className="rounded-lg bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-600">GPS 이탈</span>
                      )}
                      {item.hasIssue && (
                        <span className="rounded-lg bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600">근태 이슈</span>
                      )}
                    </div>
                  )}

                  {!item.isFinalClosed && item.startTime && (
                    <p className="mt-1.5 text-[11px] font-semibold text-amber-600">미확정</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 급여명세 탭 ── */}
      {tab === "payroll" && (
        <div className="mx-auto max-w-md px-4 pb-28 pt-4">
          {loadingPay ? (
            <div className="flex justify-center py-10">
              <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-sky-500" />
            </div>
          ) : payItems.length === 0 ? (
            <div className="rounded-3xl border border-slate-100 bg-white py-12 text-center">
              <p className="text-sm font-semibold text-slate-400">확정된 급여명세가 없습니다.</p>
              <p className="mt-1 text-xs font-semibold text-slate-300">에이전시에서 급여를 확정하면 여기서 확인할 수 있어요.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {payItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => setSelectedPay(item)}
                  className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm transition active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-900">{item.yearMonth}</p>
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">{item.agencyName} · {item.workedDays}일 근무</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-emerald-600">{comma(item.netPay)}원</p>
                      <p className="mt-0.5 text-[11px] font-semibold text-slate-400">실지급</p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-3 text-xs font-semibold text-slate-400">
                    <span>지급액 {comma(item.grossPay)}원</span>
                    <span>공제 -{comma(item.totalDeduction)}원</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = typeof window !== "undefined" && window.location.pathname === href;
          return (
            <button key={href} onClick={() => router.push(href)} className="flex flex-1 flex-col items-center justify-center gap-1 py-3">
              <Icon className={`h-5 w-5 ${isActive ? "text-slate-950" : "text-slate-400"}`} />
              <span className={`text-[10px] font-black ${isActive ? "text-slate-950" : "text-slate-400"}`}>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
