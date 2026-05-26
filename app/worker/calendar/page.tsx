"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Home,
  Plus,
  PenLine,
  Trash2,
  X,
} from "lucide-react";

// ─── 타입 ──────────────────────────────────────────────
type DayStatus = "GREEN" | "ORANGE" | "RED" | "NONE" | "HOLIDAY";

interface DayData {
  status: DayStatus;
  attendanceId: string;
  startTime: string | null;
  endTime: string | null;
  isFinalClosed: boolean;
  logCount: number;
  traineeCount: number;
  holidayName?: string;
}

interface CalendarData {
  year: number;
  month: number;
  siteName: string | null;
  assignmentStart: string | null;
  assignmentEnd: string | null;
  days: Record<string, DayData>;
  holidays: Record<string, string>;
  customHolidays: Record<string, string>;
  totalWorkDays: number;
  totalGreenDays: number;
  totalOrangeDays: number;
  totalRedDays: number;
  totalHolidayDays: number;
  trainingType: "PRE" | "FIELD" | "ADAPTATION";
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatHHMM(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const STATUS_STYLE: Record<DayStatus | "NONE", { bg: string; color: string; label: string }> = {
  GREEN:   { bg: "#f0fdf4", color: "#16a34a", label: "완료" },
  ORANGE:  { bg: "#fffbeb", color: "#d97706", label: "일지미작성" },
  RED:     { bg: "#fff1f2", color: "#e11d48", label: "미출근" },
  HOLIDAY: { bg: "#f1f5f9", color: "#64748b", label: "휴무" },
  NONE:    { bg: "transparent", color: "#9ca3af", label: "" },
};

const NAV_ITEMS = [
  { icon: Home,             label: "홈",      href: "/worker/home" },
  { icon: CalendarDays,     label: "캘린더",  href: "/worker/calendar" },
  { icon: PenLine,          label: "전자서명", href: "/worker/signature" },
  { icon: FileText,         label: "문서",    href: "/worker/docs" },
  { icon: CircleDollarSign, label: "히스토리", href: "/worker/history" },
];

export default function CalendarPage() {
  const router = useRouter();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<{ day: number; data: DayData } | null>(null);

  // 휴무 등록 시트
  const [holidaySheet, setHolidaySheet] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayReason, setNewHolidayReason] = useState("");
  const [savingHoliday, setSavingHoliday] = useState(false);

  const fetchCalendar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/worker/calendar?year=${year}&month=${month}`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  // 월 이동 시 기본 휴무일 날짜 초기화
  useEffect(() => {
    const padded = String(month).padStart(2, "0");
    setNewHolidayDate(`${year}-${padded}-01`);
  }, [year, month]);

  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  async function addHoliday() {
    if (!newHolidayDate) return;
    setSavingHoliday(true);
    try {
      const res = await fetch("/api/worker/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: newHolidayDate, reason: newHolidayReason.trim() || undefined }),
      });
      const d = await res.json();
      if (d.success) {
        setHolidaySheet(false);
        setNewHolidayReason("");
        fetchCalendar();
      } else {
        alert(d.message || "등록 실패");
      }
    } catch {
      alert("서버 오류");
    } finally {
      setSavingHoliday(false);
    }
  }

  async function deleteHoliday(date: string) {
    if (!confirm(`${date} 휴무일을 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/worker/holidays?date=${date}`, { method: "DELETE" });
      const d = await res.json();
      if (d.success) fetchCalendar();
      else alert(d.message || "삭제 실패");
    } catch {
      alert("서버 오류");
    }
  }

  const firstDay = new Date(year, month - 1, 1).getDay();
  const lastDate = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: lastDate }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  const customHolidayEntries = Object.entries(data?.customHolidays ?? {})
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-24">

        {/* 헤더 */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-base font-black text-slate-900">근무 현황</h1>
          <button
            onClick={() => setHolidaySheet(true)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
            title="휴무일 등록"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {data?.siteName && (
          <p className="mt-3 text-center text-sm font-black text-sky-600">
            {data.siteName}
          </p>
        )}

        {/* 월 네비 */}
        <div className="flex items-center justify-between px-5 py-4">
          <button
            onClick={prevMonth}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <span className="text-xl font-black text-slate-900">{year}년 {month}월</span>
          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-slate-200 text-slate-600 transition active:scale-95 disabled:opacity-30"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        {/* 통계 */}
        {data && (
          <div className="mx-4 mb-4 flex rounded-2xl border border-slate-100 bg-white py-4 shadow-sm">
            {[
              { num: data.totalWorkDays,    label: "출근일",     color: "text-slate-900" },
              { num: data.totalGreenDays,   label: "완료",       color: "text-emerald-600" },
              { num: data.totalOrangeDays,  label: "일지미작성", color: data.totalOrangeDays > 0 ? "text-amber-500" : "text-slate-300" },
              { num: data.totalRedDays ?? 0, label: "미출근",    color: (data.totalRedDays ?? 0) > 0 ? "text-rose-500" : "text-slate-300" },
              { num: data.totalHolidayDays ?? 0, label: "휴무",  color: "text-slate-400" },
            ].map(({ num, label, color }, i, arr) => (
              <div key={label} className={`flex flex-1 flex-col items-center gap-1 ${i < arr.length - 1 ? "border-r border-slate-100" : ""}`}>
                <span className={`text-xl font-black tabular-nums ${color}`}>{num}</span>
                <span className="text-[10px] font-semibold text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 px-4 mb-1">
          {WEEKDAYS.map((d, i) => (
            <div
              key={d}
              className={`py-1 text-center text-xs font-black ${
                i === 0 ? "text-rose-500" : i === 6 ? "text-blue-600" : "text-slate-400"
              }`}
            >
              {d}
            </div>
          ))}
        </div>

        {/* 캘린더 그리드 */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-sky-500" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 px-4">
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} className="aspect-square" />;

              const key = dateKey(year, month, day);
              const dayData = data?.days[key];
              const status: DayStatus = dayData?.status ?? "NONE";
              const st = STATUS_STYLE[status];
              const isToday = key === todayKey;
              const isWeekend = idx % 7 === 0 || idx % 7 === 6;
              const isHoliday = status === "HOLIDAY";
              const isNationalHoliday = isHoliday && !data?.customHolidays?.[key];

              return (
                <button
                  key={idx}
                  style={{ backgroundColor: st.bg }}
                  className={`aspect-square flex flex-col items-center justify-center gap-0.5 rounded-xl border transition active:scale-95 ${
                    isToday ? "border-sky-400" : "border-transparent"
                  } ${!dayData ? "opacity-40 cursor-default" : "cursor-pointer"}`}
                  onClick={() => dayData && setSelectedDay({ day, data: dayData })}
                  disabled={!dayData}
                >
                  <span
                    className={`text-sm font-black leading-none ${
                      isToday ? "text-sky-600"
                        : isHoliday ? "text-slate-500"
                        : isWeekend ? (idx % 7 === 0 ? "text-rose-500" : "text-blue-600")
                        : "text-slate-700"
                    }`}
                  >
                    {day}
                  </span>
                  {status !== "NONE" && (
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: st.color }}
                    />
                  )}
                  {status === "GREEN" && (
                    <span className="text-[9px] font-black text-emerald-500">✓</span>
                  )}
                  {isNationalHoliday && (
                    <span className="text-[8px] font-black text-slate-400 leading-none">공휴</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 범례 */}
        <div className="flex flex-wrap justify-center gap-4 py-4">
          {(["GREEN", "ORANGE", "RED", "HOLIDAY"] as DayStatus[]).map(st => (
            <div key={st} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_STYLE[st].color }}
              />
              <span className="text-xs font-semibold text-slate-500">{STATUS_STYLE[st].label}</span>
            </div>
          ))}
        </div>

        {/* 일지 미작성 안내 */}
        {data && data.totalOrangeDays > 0 && (
          <div className="mx-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" aria-hidden="true" />
            <div>
              <p className="text-sm font-black text-amber-700">일지 미작성 {data.totalOrangeDays}일이 있어요</p>
              <p className="mt-0.5 text-xs font-semibold text-amber-600">주황색 날짜를 눌러 일지를 작성해주세요.</p>
            </div>
          </div>
        )}

        {/* 커스텀 휴무일 목록 */}
        {customHolidayEntries.length > 0 && (
          <div className="mx-4 mt-4 rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-sm font-black text-slate-700">등록된 현장 휴무일</p>
            <div className="flex flex-col gap-2">
              {customHolidayEntries.map(([date, reason]) => (
                <div key={date} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-sm font-black text-slate-800">{date}</p>
                    {reason && <p className="text-xs font-semibold text-slate-400">{reason}</p>}
                  </div>
                  <button
                    onClick={() => deleteHoliday(date)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 하단 네비게이션 */}
      <nav className="fixed bottom-0 left-1/2 z-40 flex w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white pb-safe-bottom">
        {NAV_ITEMS.map(({ icon: Icon, label, href }) => {
          const isActive = typeof window !== "undefined" && window.location.pathname === href;
          return (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="flex flex-1 flex-col items-center justify-center gap-1 py-3"
            >
              <Icon className={`h-5 w-5 ${isActive ? "text-slate-950" : "text-slate-400"}`} aria-hidden="true" />
              <span className={`text-[10px] font-black ${isActive ? "text-slate-950" : "text-slate-400"}`}>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* 날짜 상세 모달 */}
      {selectedDay && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-10 pt-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="text-lg font-black text-slate-900">{month}월 {selectedDay.day}일</span>
              <button
                onClick={() => setSelectedDay(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              {selectedDay.data.status === "HOLIDAY" ? (
                <div className="rounded-2xl bg-slate-100 px-4 py-3 text-center">
                  <p className="text-sm font-black text-slate-600">
                    🗓 {selectedDay.data.holidayName || "휴무일"}
                  </p>
                  {data?.customHolidays?.[dateKey(year, month, selectedDay.day)] && (
                    <p className="mt-1 text-xs font-semibold text-slate-400">현장 지정 휴무</p>
                  )}
                </div>
              ) : (
                <>
                  <div
                    className="rounded-2xl px-4 py-3 text-center text-sm font-black"
                    style={{
                      backgroundColor: STATUS_STYLE[selectedDay.data.status].bg,
                      color: STATUS_STYLE[selectedDay.data.status].color,
                    }}
                  >
                    {selectedDay.data.status === "GREEN" ? "✓ 일지 완료"
                      : selectedDay.data.status === "ORANGE" ? "⚠ 일지 미작성"
                      : "✗ 미출근"}
                  </div>

                  {selectedDay.data.startTime ? (
                    <div className="flex items-center justify-center gap-4">
                      <div className="text-center">
                        <p className="text-xs font-semibold text-slate-400">출근</p>
                        <p className="text-xl font-black text-slate-900">{formatHHMM(selectedDay.data.startTime)}</p>
                      </div>
                      <span className="text-slate-300">–</span>
                      <div className="text-center">
                        <p className="text-xs font-semibold text-slate-400">퇴근</p>
                        <p className="text-xl font-black text-slate-900">{formatHHMM(selectedDay.data.endTime)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-center text-sm font-semibold text-slate-400">출근 기록이 없습니다.</p>
                  )}

                  {selectedDay.data.traineeCount > 0 && (
                    <p className="text-center text-sm font-semibold text-slate-500">
                      일지 {selectedDay.data.logCount}/{selectedDay.data.traineeCount}명 완료
                    </p>
                  )}

                  {selectedDay.data.status === "ORANGE" && (
                    <button
                      className="w-full min-h-14 rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97]"
                      onClick={() => {
                        setSelectedDay(null);
                        const aid = selectedDay.data.attendanceId;
                        const tt  = data?.trainingType || "FIELD";
                        if (aid) {
                          const p = new URLSearchParams({ attendanceId: aid, trainingType: tt });
                          router.push(`/worker/worklog?${p.toString()}`);
                        } else {
                          router.push("/worker/home");
                        }
                      }}
                    >
                      일지 작성하러 가기
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 휴무일 등록 시트 */}
      {holidaySheet && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50"
          onClick={() => setHolidaySheet(false)}
        >
          <div
            className="w-full max-w-md rounded-t-3xl bg-white px-5 pb-10 pt-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="text-lg font-black text-slate-900">현장 휴무일 등록</span>
              <button
                onClick={() => setHolidaySheet(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <p className="mb-4 text-sm font-semibold text-slate-400">
              현장 사정으로 쉬는 날을 등록하면 해당 날짜는 미출근으로 표시되지 않습니다.
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-black text-slate-600">날짜</label>
                <input
                  type="date"
                  value={newHolidayDate}
                  onChange={e => setNewHolidayDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 outline-none focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-black text-slate-600">사유 (선택)</label>
                <input
                  type="text"
                  value={newHolidayReason}
                  onChange={e => setNewHolidayReason(e.target.value)}
                  placeholder="예: 현장 작업 없음, 공장 점검 등"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none placeholder:font-normal placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                />
              </div>
              <button
                onClick={addHoliday}
                disabled={savingHoliday || !newHolidayDate}
                className="w-full rounded-2xl bg-slate-950 py-4 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-50"
              >
                {savingHoliday ? "등록 중..." : "휴무일 등록"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
