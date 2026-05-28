"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart2, CalendarDays, ChevronLeft, ChevronRight,
  CircleDollarSign, ClipboardList, FileText, Home,
  PenLine, Trash2, X,
} from "lucide-react";

type TrainingType = "PRE" | "FIELD" | "ADAPTATION";

interface LogItem {
  id: string;
  traineeId: string;
  attendanceId: string;
  traineeName: string;
  workDate: string;
  trainingType: TrainingType;
  attendance: string;
  totalTime: number;
  taskName: string;
  taskScore: number | null;
  isCompleted: boolean;
  content: string;
  measurementTime: string;
  specialNotes: string;
}

const NAV_ITEMS = [
  { icon: Home,             label: "홈",       href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",   href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",     href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

const TYPE_LABEL: Record<TrainingType, string> = {
  PRE:        "사전훈련",
  FIELD:      "현장훈련",
  ADAPTATION: "적응지도",
};

const TYPE_COLOR: Record<TrainingType, string> = {
  PRE:        "bg-sky-100 text-sky-700",
  FIELD:      "bg-emerald-100 text-emerald-700",
  ADAPTATION: "bg-violet-100 text-violet-700",
};

const SCORE_LABELS = ["", "매우못함", "못함", "보통", "잘함", "매우잘함"];

function defaultPeriod() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(last).padStart(2, "0")}` };
}

export default function LogsPage() {
  const router = useRouter();
  const def = defaultPeriod();

  const [logs, setLogs]         = useState<LogItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [periodStart, setPeriodStart] = useState(def.start);
  const [periodEnd, setPeriodEnd]     = useState(def.end);
  const [filterType, setFilterType]   = useState<string>("ALL");
  const [selected, setSelected]       = useState<LogItem | null>(null);
  const [deleting, setDeleting]       = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ periodStart, periodEnd });
      if (filterType !== "ALL") p.set("trainingType", filterType);
      const res = await fetch(`/api/worker/logs/list?${p.toString()}`);
      const d = await res.json();
      if (d.success) setLogs(d.logs);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [periodStart, periodEnd, filterType]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  async function deleteLog(id: string) {
    if (!confirm("이 일지를 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/worker/logs/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (d.success) {
        setSelected(null);
        fetchLogs();
      } else {
        alert(d.message || "삭제 실패");
      }
    } catch { alert("서버 오류"); } finally { setDeleting(false); }
  }

  function editLog(log: LogItem) {
    const p = new URLSearchParams({
      logId:        log.id,
      traineeId:    log.traineeId,
      attendanceId: log.attendanceId,
      traineeName:  log.traineeName,
      trainingType: log.trainingType,
    });
    router.push(`/worker/worklog?${p.toString()}`);
  }

  // 날짜별 그룹
  const grouped: Record<string, LogItem[]> = {};
  for (const l of logs) {
    (grouped[l.workDate] ??= []).push(l);
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-24">

        {/* 헤더 */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-black text-slate-900">일지 목록</h1>
          <div className="w-9" />
        </header>

        {/* 기간 + 필터 */}
        <div className="space-y-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
              className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
            <span className="text-sm font-semibold text-slate-400">~</span>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
              className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400" />
          </div>

          {/* 유형 필터 */}
          <div className="flex gap-2">
            {[
              { val: "ALL",        label: "전체" },
              { val: "PRE",        label: "사전훈련" },
              { val: "FIELD",      label: "현장훈련" },
              { val: "ADAPTATION", label: "적응지도" },
            ].map(({ val, label }) => (
              <button key={val} onClick={() => setFilterType(val)}
                className={`flex-1 rounded-xl border py-2 text-xs font-black transition active:scale-95 ${filterType === val ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 일지 목록 */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-sky-500" />
          </div>
        ) : logs.length === 0 ? (
          <div className="mx-4 mt-4 rounded-2xl border border-slate-100 bg-white py-12 text-center">
            <ClipboardList className="mx-auto mb-3 h-10 w-10 text-slate-200" />
            <p className="text-sm font-semibold text-slate-400">작성된 일지가 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-4 px-4">
            {sortedDates.map(date => (
              <div key={date}>
                <p className="mb-2 text-xs font-black text-slate-400">{date.replace(/-/g, ".")}</p>
                <div className="space-y-2">
                  {grouped[date].map(log => (
                    <button key={log.id} onClick={() => setSelected(log)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3.5 text-left shadow-sm transition active:scale-[0.98]">
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-sm font-black text-slate-600">
                        {log.traineeName.slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-black text-slate-900">{log.traineeName}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${TYPE_COLOR[log.trainingType]}`}>
                            {TYPE_LABEL[log.trainingType]}
                          </span>
                          {log.isCompleted
                            ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-600">완료</span>
                            : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-600">임시저장</span>}
                        </div>
                        <div className="flex items-center gap-3 text-xs font-semibold text-slate-400">
                          <span>출결: {log.attendance}</span>
                          <span>인정: {log.totalTime.toFixed(1)}H</span>
                          {log.taskScore && <span>수행: {SCORE_LABELS[log.taskScore]}</span>}
                        </div>
                        {log.taskName && (
                          <p className="mt-1 truncate text-xs font-semibold text-slate-500">과제: {log.taskName}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = typeof window !== "undefined" && window.location.pathname === href;
          return (
            <button key={href} onClick={() => router.push(href)}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-3">
              <Icon className={`h-5 w-5 ${isActive ? "text-slate-950" : "text-slate-400"}`} />
              <span className={`text-[10px] font-black ${isActive ? "text-slate-950" : "text-slate-400"}`}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 일지 상세 모달 */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50"
          onClick={() => setSelected(null)}>
          <div className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-10 pt-6"
            onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-black text-slate-900">{selected.traineeName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-black ${TYPE_COLOR[selected.trainingType]}`}>
                    {TYPE_LABEL[selected.trainingType]}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-400">{selected.workDate.replace(/-/g, ".")}</p>
              </div>
              <button onClick={() => setSelected(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 rounded-2xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between"><span className="font-semibold text-slate-500">출결</span><span className="font-black text-slate-800">{selected.attendance}</span></div>
              <div className="flex justify-between"><span className="font-semibold text-slate-500">공단 인정 시간</span><span className="font-black text-slate-800">{selected.totalTime.toFixed(1)}H</span></div>
              {selected.taskName && <div className="flex justify-between"><span className="font-semibold text-slate-500">수행 과제</span><span className="font-black text-slate-800 text-right max-w-[60%]">{selected.taskName}</span></div>}
              {selected.taskScore && <div className="flex justify-between"><span className="font-semibold text-slate-500">수행 정도</span><span className="font-black text-slate-800">{SCORE_LABELS[selected.taskScore]} ({selected.taskScore}점)</span></div>}
              {selected.measurementTime && <div className="flex justify-between"><span className="font-semibold text-slate-500">측정 시간</span><span className="font-black text-slate-800">{selected.measurementTime}H</span></div>}
              {selected.content && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="font-semibold text-slate-500 mb-1">{selected.trainingType === "ADAPTATION" ? "지도사항" : "평가 및 지도사항"}</p>
                  <p className="text-slate-700 leading-relaxed text-xs">{selected.content}</p>
                </div>
              )}
              {selected.specialNotes && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="font-semibold text-slate-500 mb-1">특이사항</p>
                  <p className="text-slate-700 leading-relaxed text-xs">{selected.specialNotes}</p>
                </div>
              )}
              <div className="flex justify-between pt-1">
                <span className="font-semibold text-slate-500">상태</span>
                <span className={`font-black ${selected.isCompleted ? "text-emerald-600" : "text-amber-600"}`}>
                  {selected.isCompleted ? "완료" : "임시저장"}
                </span>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button onClick={() => deleteLog(selected.id)} disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 py-3.5 text-sm font-black text-rose-600 transition active:scale-95 disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
                삭제
              </button>
              <button onClick={() => editLog(selected)}
                className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-slate-950 py-3.5 text-sm font-black text-white transition active:scale-95">
                <PenLine className="h-4 w-4" />
                수정하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
