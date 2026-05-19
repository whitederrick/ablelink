"use client";
// app/worker/calendar/page.tsx
// 월별 출근/일지 현황 캘린더

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ─── 타입 ──────────────────────────────────────────────
type DayStatus = "GREEN" | "ORANGE" | "RED" | "NONE";

interface DayData {
  status: DayStatus;
  startTime: string | null;
  endTime: string | null;
  isFinalClosed: boolean;
  logCount: number;
  traineeCount: number;
}

interface CalendarData {
  year: number;
  month: number;
  siteName: string | null;
  assignmentStart: string | null;
  assignmentEnd: string | null;
  days: Record<string, DayData>;
  totalWorkDays: number;
  totalGreenDays: number;
  totalOrangeDays: number;
}

// ─── 유틸 ──────────────────────────────────────────────
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function formatHHMM(iso: string | null): string {
  if (!iso) return "--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── 상태별 스타일 ──────────────────────────────────────
const STATUS_STYLE: Record<DayStatus | "NONE", { bg: string; color: string; label: string }> = {
  GREEN:  { bg: "#e8f5e9", color: "#2e7d32", label: "완료" },
  ORANGE: { bg: "#fff8e1", color: "#f57c00", label: "일지미작성" },
  RED:    { bg: "#ffebee", color: "#c62828", label: "미출근" },
  NONE:   { bg: "transparent", color: "#999", label: "" },
};

// ─── 메인 컴포넌트 ──────────────────────────────────────
export default function CalendarPage() {
  const router = useRouter();
  const today = new Date();

  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<{ day: number; data: DayData } | null>(null);

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

  // 이전/다음 달
  function prevMonth() {
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }

  // 캘린더 날짜 배열 생성
  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=일
  const lastDate = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: lastDate }, (_, i) => i + 1),
  ];
  // 6주 맞추기
  while (cells.length % 7 !== 0) cells.push(null);

  const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth() + 1;

  return (
    <div style={s.page}>
      <div style={s.container}>

        {/* 헤더 */}
        <div style={s.header}>
          <button onClick={() => router.back()} style={s.backBtn}>←</button>
          <h1 style={s.title}>근무 현황</h1>
          <div style={{ width: 36 }} />
        </div>

        {/* 현장명 */}
        {data?.siteName && (
          <p style={s.siteName}>📍 {data.siteName}</p>
        )}

        {/* 월 네비게이션 */}
        <div style={s.monthNav}>
          <button style={s.navBtn} onClick={prevMonth}>‹</button>
          <span style={s.monthLabel}>{year}년 {month}월</span>
          <button
            style={{ ...s.navBtn, opacity: isCurrentMonth ? 0.3 : 1 }}
            onClick={nextMonth}
            disabled={isCurrentMonth}
          >›</button>
        </div>

        {/* 요약 통계 */}
        {data && (
          <div style={s.summary}>
            <div style={s.summaryItem}>
              <span style={s.summaryNum}>{data.totalWorkDays}</span>
              <span style={s.summaryLabel}>출근일</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={{ ...s.summaryNum, color: "#2e7d32" }}>{data.totalGreenDays}</span>
              <span style={s.summaryLabel}>일지완료</span>
            </div>
            <div style={s.summaryDivider} />
            <div style={s.summaryItem}>
              <span style={{ ...s.summaryNum, color: "#f57c00" }}>{data.totalOrangeDays}</span>
              <span style={s.summaryLabel}>일지미작성</span>
            </div>
          </div>
        )}

        {/* 요일 헤더 */}
        <div style={s.weekRow}>
          {WEEKDAYS.map((d, i) => (
            <div key={d} style={{
              ...s.weekDay,
              color: i === 0 ? "#e53935" : i === 6 ? "#1565c0" : "#888",
            }}>{d}</div>
          ))}
        </div>

        {/* 캘린더 그리드 */}
        {loading ? (
          <div style={s.loadingBox}>
            <div style={s.spinner} />
          </div>
        ) : (
          <div style={s.grid}>
            {cells.map((day, idx) => {
              if (!day) return <div key={idx} style={s.emptyCell} />;

              const key = dateKey(year, month, day);
              const dayData = data?.days[key];
              const status: DayStatus = dayData?.status ?? "NONE";
              const st = STATUS_STYLE[status];
              const isToday = key === todayKey;
              const isWeekend = idx % 7 === 0 || idx % 7 === 6;

              return (
                <button
                  key={idx}
                  style={{
                    ...s.cell,
                    backgroundColor: st.bg,
                    opacity: status === "NONE" && !isToday ? 0.6 : 1,
                  }}
                  onClick={() => dayData && setSelectedDay({ day, data: dayData })}
                  disabled={!dayData}
                >
                  <span style={{
                    ...s.dayNum,
                    color: isToday ? "#2563eb"
                      : isWeekend ? (idx % 7 === 0 ? "#e53935" : "#1565c0")
                      : "#333",
                    fontWeight: isToday ? 700 : 400,
                  }}>
                    {day}
                    {isToday && <span style={s.todayDot}>•</span>}
                  </span>
                  {status !== "NONE" && (
                    <span style={{ ...s.statusDot, backgroundColor: st.color }} />
                  )}
                  {status === "GREEN" && (
                    <span style={s.checkMark}>✓</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 범례 */}
        <div style={s.legend}>
          {(["GREEN", "ORANGE", "RED"] as DayStatus[]).map(st => (
            <div key={st} style={s.legendItem}>
              <span style={{ ...s.legendDot, backgroundColor: STATUS_STYLE[st].color }} />
              <span style={s.legendLabel}>{STATUS_STYLE[st].label}</span>
            </div>
          ))}
        </div>

        {/* 일지 미작성 안내 */}
        {data && data.totalOrangeDays > 0 && (
          <div style={s.warningBox}>
            <span style={s.warningIcon}>⚠️</span>
            <div>
              <p style={s.warningTitle}>일지 미작성 {data.totalOrangeDays}일이 있어요</p>
              <p style={s.warningDesc}>주황색 날짜를 눌러 일지를 작성해주세요.</p>
            </div>
          </div>
        )}

      </div>

      {/* ── 하단 네비게이션 ── */}
      <nav style={s.bottomNav}>
        <button style={s.navItem} onClick={() => router.push("/worker/home")}>
          <span style={s.navIcon}>🏠</span>
          <span style={s.navLabel}>홈</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/calendar")}>
          <span style={{ ...s.navIcon, color: "#2563eb" }}>📅</span>
          <span style={{ ...s.navLabel, color: "#2563eb" }}>캘린더</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/signature")}>
          <span style={s.navIcon}>✍️</span>
          <span style={s.navLabel}>전자서명</span>
        </button>
        <button style={s.navItem} onClick={() => router.push("/worker/docs")}>
          <span style={s.navIcon}>📄</span>
          <span style={s.navLabel}>문서</span>
        </button>
      </nav>

      {/* 날짜 상세 모달 */}
      {selectedDay && (
        <div style={s.overlay} onClick={() => setSelectedDay(null)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <span style={s.modalTitle}>{month}월 {selectedDay.day}일</span>
              <button style={s.closeBtn} onClick={() => setSelectedDay(null)}>✕</button>
            </div>

            <div style={s.modalBody}>
              <div style={{
                ...s.statusBadge,
                backgroundColor: STATUS_STYLE[selectedDay.data.status].bg,
                color: STATUS_STYLE[selectedDay.data.status].color,
              }}>
                {selectedDay.data.status === "GREEN" ? "✓ 일지 완료"
                  : selectedDay.data.status === "ORANGE" ? "⚠ 일지 미작성"
                  : "✗ 미출근"}
              </div>

              {selectedDay.data.startTime && (
                <div style={s.timeRow}>
                  <span style={s.timeLabel}>출근</span>
                  <span style={s.timeValue}>{formatHHMM(selectedDay.data.startTime)}</span>
                  <span style={s.timeLabel}>퇴근</span>
                  <span style={s.timeValue}>{formatHHMM(selectedDay.data.endTime)}</span>
                </div>
              )}

              {selectedDay.data.traineeCount > 0 && (
                <p style={s.logInfo}>
                  일지 {selectedDay.data.logCount}/{selectedDay.data.traineeCount}명 완료
                </p>
              )}

              {selectedDay.data.status === "ORANGE" && (
                <button
                  style={s.writeBtn}
                  onClick={() => {
                    setSelectedDay(null);
                    router.push("/worker/home");
                  }}
                >
                  일지 작성하러 가기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 스타일 ──────────────────────────────────────────────
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f7f8fa" },
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, backgroundColor: "#fff", borderTop: "1px solid #eee", display: "flex", zIndex: 100, paddingBottom: "env(safe-area-inset-bottom)" },
  navItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, padding: "10px 0", border: "none", backgroundColor: "transparent", cursor: "pointer" },
  navIcon: { fontSize: 22 },
  navLabel: { fontSize: 11, color: "#888", fontWeight: 500 },
  container: { maxWidth: 480, margin: "0 auto", padding: "0 0 90px" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", backgroundColor: "#fff", borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#333", width: 36 },
  title: { fontSize: 18, fontWeight: 700, color: "#333", margin: 0 },

  siteName: { fontSize: 14, color: "#2563eb", fontWeight: 600, textAlign: "center", margin: "12px 0 0", padding: "0 16px" },

  monthNav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px" },
  navBtn: { background: "none", border: "none", fontSize: 28, cursor: "pointer", color: "#333", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 20, fontWeight: 700, color: "#333" },

  summary: { display: "flex", backgroundColor: "#fff", margin: "0 16px 16px", borderRadius: 14, padding: "16px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  summaryItem: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
  summaryNum: { fontSize: 24, fontWeight: 700, color: "#333" },
  summaryLabel: { fontSize: 12, color: "#888" },
  summaryDivider: { width: 1, backgroundColor: "#eee", margin: "0 8px" },

  weekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 16px", marginBottom: 4 },
  weekDay: { textAlign: "center", fontSize: 13, fontWeight: 600, padding: "4px 0" },

  grid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, padding: "0 16px" },
  emptyCell: { aspectRatio: "1", borderRadius: 10 },
  cell: { aspectRatio: "1", borderRadius: 10, border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, position: "relative", transition: "transform 0.1s" },
  dayNum: { fontSize: 15, lineHeight: 1 },
  todayDot: { color: "#2563eb", fontSize: 10, marginLeft: 1 },
  statusDot: { width: 6, height: 6, borderRadius: "50%" },
  checkMark: { fontSize: 10, color: "#2e7d32", fontWeight: 700 },

  loadingBox: { display: "flex", justifyContent: "center", padding: "40px 0" },
  spinner: { width: 32, height: 32, border: "3px solid #e5e7eb", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },

  legend: { display: "flex", justifyContent: "center", gap: 20, padding: "16px 0", marginTop: 8 },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: "50%" },
  legendLabel: { fontSize: 12, color: "#666" },

  warningBox: { display: "flex", alignItems: "flex-start", gap: 10, margin: "12px 16px 0", backgroundColor: "#fff8e1", padding: "14px", borderRadius: 12, border: "1px solid #ffe082" },
  warningIcon: { fontSize: 20, flexShrink: 0 },
  warningTitle: { fontSize: 14, fontWeight: 700, color: "#f57c00", margin: "0 0 2px" },
  warningDesc: { fontSize: 12, color: "#888", margin: 0 },

  // 모달
  overlay: { position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 1000 },
  modal: { backgroundColor: "#fff", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 480, padding: "24px 20px 40px" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "#333" },
  closeBtn: { background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#888" },
  modalBody: { display: "flex", flexDirection: "column", gap: 14 },
  statusBadge: { padding: "10px 16px", borderRadius: 10, fontSize: 15, fontWeight: 700, textAlign: "center" },
  timeRow: { display: "flex", alignItems: "center", gap: 12, justifyContent: "center" },
  timeLabel: { fontSize: 13, color: "#888" },
  timeValue: { fontSize: 20, fontWeight: 700, color: "#333" },
  logInfo: { textAlign: "center", fontSize: 14, color: "#666", margin: 0 },
  writeBtn: { width: "100%", padding: "14px", backgroundColor: "#2563eb", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer" },
};
