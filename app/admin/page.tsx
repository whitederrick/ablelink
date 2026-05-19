"use client";
// app/admin/page.tsx
// 관리자 대시보드 — 실시간 출근/일지/GPS 현황

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface DashboardData {
  today: string;
  summary: {
    totalActiveCoaches: number;
    clockedIn: number;
    clockedOut: number;
    finalized: number;
    gpsIssues: number;
    logCompleted: number;
    logPending: number;
  };
  month: {
    workDays: number;
    totalHours: number;
    completedDocs: number;
  };
  gpsPendingList: Array<{ id: string; userName: string; siteName: string; workDate: string; }>;
  todayList: Array<{
    id: string;
    userName: string;
    siteName: string;
    clockIn: string | null;
    clockOut: string | null;
    isFinalClosed: boolean;
    isGpsModified: boolean;
    logStatus: "미작성" | "임시저장" | "완료";
  }>;
}

const LOG_COLOR: Record<string, string> = {
  완료: "#2e7d32", 임시저장: "#f57c00", 미작성: "#c62828",
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (json.success) { setData(json.data); setLastUpdated(new Date()); }
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const t = setInterval(fetchDashboard, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, [fetchDashboard]);

  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <p style={{ color: "#888", marginTop: 12 }}>로딩 중...</p>
    </div>
  );

  const d = data;
  const todayFmt = d?.today
    ? `${d.today.slice(0,4)}년 ${Number(d.today.slice(5,7))}월 ${Number(d.today.slice(8,10))}일`
    : "";

  return (
    <div style={s.page}>
      {/* 헤더 */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>대시보드</h1>
          <p style={s.subtitle}>{todayFmt}</p>
        </div>
        <button style={s.refreshBtn} onClick={fetchDashboard}>
          🔄 새로고침
          <span style={s.lastUpdated}>
            {lastUpdated.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 업데이트
          </span>
        </button>
      </div>

      {/* 핵심 지표 */}
      <div style={s.statsGrid}>
        {[
          { label: "활성 직무지도원", value: d?.summary.totalActiveCoaches ?? 0, unit: "명", color: "#333" },
          { label: "오늘 출근", value: d?.summary.clockedIn ?? 0, unit: `/ ${d?.summary.totalActiveCoaches ?? 0}명`, color: "#2e7d32" },
          { label: "일지 완료", value: d?.summary.logCompleted ?? 0, unit: "명", color: "#5865F2" },
          { label: "일지 미작성", value: d?.summary.logPending ?? 0, unit: "명", color: "#f57c00" },
        ].map((item, i) => (
          <div key={i} style={{ ...s.statCard, borderTop: `3px solid ${item.color}` }}>
            <p style={s.statLabel}>{item.label}</p>
            <p style={{ ...s.statNum, color: item.color }}>{item.value}</p>
            <p style={s.statSub}>{item.unit}</p>
          </div>
        ))}
      </div>

      {/* GPS 이탈 승인 대기 */}
      {d && d.gpsPendingList.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>
              ⚠️ GPS 이탈 승인 대기
              <span style={s.badge}>{d.gpsPendingList.length}</span>
            </h2>
            <button style={s.linkBtn} onClick={() => router.push("/admin/inbox/attendance")}>
              전체 보기 →
            </button>
          </div>
          {d.gpsPendingList.map(g => (
            <div key={g.id} style={s.listRow}>
              <div>
                <span style={s.userName}>{g.userName}</span>
                <span style={s.siteName}>{g.siteName}</span>
              </div>
              <button style={s.approveBtn} onClick={() => router.push("/admin/inbox/attendance")}>
                처리
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 이번 달 통계 */}
      <div style={s.section}>
        <h2 style={s.sectionTitle}>📊 이번 달 통계</h2>
        <div style={s.monthGrid}>
          {[
            { num: d?.month.workDays ?? 0, label: "총 출근일", unit: "일" },
            { num: d?.month.totalHours ?? 0, label: "총 인정시간", unit: "H" },
            { num: d?.month.completedDocs ?? 0, label: "일지 완료", unit: "건" },
          ].map((item, i) => (
            <div key={i} style={s.monthCard}>
              <p style={s.monthNum}>{item.num}{item.unit}</p>
              <p style={s.monthLabel}>{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 오늘 출근 목록 */}
      <div style={s.section}>
        <div style={s.sectionHeader}>
          <h2 style={s.sectionTitle}>📋 오늘 출근 현황</h2>
          <button style={s.linkBtn} onClick={() => router.push("/admin/attendances")}>
            전체 보기 →
          </button>
        </div>
        {!d?.todayList.length ? (
          <p style={s.emptyText}>오늘 출근 기록이 없습니다.</p>
        ) : (
          <div style={s.table}>
            <div style={s.tableHeader}>
              <span style={{ flex: 1.5 }}>직무지도원</span>
              <span style={{ flex: 2 }}>현장</span>
              <span style={{ flex: 0.8, textAlign: "center" }}>출근</span>
              <span style={{ flex: 0.8, textAlign: "center" }}>퇴근</span>
              <span style={{ flex: 0.8, textAlign: "center" }}>일지</span>
            </div>
            {d.todayList.map(row => (
              <div key={row.id} style={s.tableRow}>
                <span style={{ flex: 1.5, fontWeight: 600 }}>
                  {row.userName}
                  {row.isGpsModified && <span style={s.gpsBadge}>GPS</span>}
                </span>
                <span style={{ flex: 2, color: "#666", fontSize: 13 }}>{row.siteName}</span>
                <span style={{ flex: 0.8, textAlign: "center", color: row.clockIn ? "#2e7d32" : "#ccc" }}>
                  {row.clockIn || "-"}
                </span>
                <span style={{ flex: 0.8, textAlign: "center", color: row.clockOut ? "#333" : "#ccc" }}>
                  {row.clockOut || "-"}
                </span>
                <span style={{ flex: 0.8, textAlign: "center", fontSize: 12, fontWeight: 700, color: LOG_COLOR[row.logStatus] || "#999" }}>
                  {row.logStatus}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24, maxWidth: 1000 },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 300 },
  spinner: { width: 36, height: 36, border: "3px solid #e0e5ff", borderTop: "3px solid #5865F2", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 800, color: "#111", margin: "0 0 4px" },
  subtitle: { fontSize: 14, color: "#888", margin: 0 },
  refreshBtn: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, background: "none", border: "1px solid #eee", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13, color: "#555" },
  lastUpdated: { fontSize: 11, color: "#aaa" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 },
  statCard: { backgroundColor: "#fff", borderRadius: 12, padding: "20px 16px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)", borderTop: "3px solid #eee" },
  statLabel: { fontSize: 13, color: "#888", margin: "0 0 8px" },
  statNum: { fontSize: 32, fontWeight: 800, margin: "0 0 4px" },
  statSub: { fontSize: 13, color: "#aaa", margin: 0 },
  section: { backgroundColor: "#fff", borderRadius: 14, padding: 20, marginBottom: 20, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  sectionTitle: { fontSize: 15, fontWeight: 700, color: "#333", margin: 0, display: "flex", alignItems: "center", gap: 8 },
  badge: { backgroundColor: "#e53935", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 10, padding: "2px 7px" },
  linkBtn: { fontSize: 13, color: "#5865F2", background: "none", border: "none", cursor: "pointer", fontWeight: 600 },
  listRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", backgroundColor: "#fff8e1", borderRadius: 8, border: "1px solid #ffe082", marginBottom: 8 },
  userName: { fontSize: 14, fontWeight: 700, color: "#333", marginRight: 8 },
  siteName: { fontSize: 13, color: "#888" },
  approveBtn: { padding: "6px 14px", backgroundColor: "#5865F2", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  monthGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 },
  monthCard: { backgroundColor: "#f8f9ff", borderRadius: 10, padding: 16, textAlign: "center" },
  monthNum: { fontSize: 28, fontWeight: 800, color: "#5865F2", margin: "0 0 4px" },
  monthLabel: { fontSize: 13, color: "#888", margin: 0 },
  table: { display: "flex", flexDirection: "column" },
  tableHeader: { display: "flex", padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#888", borderBottom: "1px solid #eee", marginBottom: 4 },
  tableRow: { display: "flex", alignItems: "center", padding: "10px 12px", fontSize: 14, color: "#333", borderBottom: "1px solid #f5f5f5" },
  gpsBadge: { display: "inline-block", fontSize: 10, backgroundColor: "#fff3e0", color: "#f57c00", borderRadius: 4, padding: "1px 5px", marginLeft: 6, fontWeight: 700 },
  emptyText: { color: "#aaa", fontSize: 14, textAlign: "center", padding: "20px 0", margin: 0 },
};
