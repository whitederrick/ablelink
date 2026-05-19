"use client";
// app/admin/attendances/page.tsx
// 근태 현황 페이지 — 월별 출퇴근 기록 조회

import { useEffect, useState } from "react";

type AttendanceItem = {
  id: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  isFinalClosed: boolean;
  isGpsModified: boolean;
  status: string;
  startDistanceM: number | null;
  endDistanceM: number | null;
  withinRange: boolean | null;
  site: { companyName: string } | null;
  user: { userName: string; phoneNumber: string } | null;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }
function getDefaultYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function formatTime(iso: string | null) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  BEFORE:  { label: "출근전",   color: "#888",    bg: "#f5f5f5" },
  WORKING: { label: "근무중",   color: "#2e7d32", bg: "#e8f5e9" },
  DONE:    { label: "마감중",   color: "#f57c00", bg: "#fff8e1" },
  CLOSED:  { label: "종료",     color: "#5865F2", bg: "#f0f2ff" },
};

export default function AttendancesPage() {
  const [yearMonth, setYearMonth] = useState(getDefaultYearMonth());
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<AttendanceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const [y, m] = yearMonth.split("-").map(Number);
      const from = `${yearMonth}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const to = `${yearMonth}-${pad2(lastDay)}`;

      const params = new URLSearchParams({ from, to, pageSize: "200", page: "1" });
      if (search.trim()) params.set("q", search.trim());

      const res = await fetch(`/api/admin/attendances?${params}`);
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setTotal(data.total || 0);
      }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { fetchData(); }, [yearMonth]);

  const clockedIn = items.filter(i => i.startTime).length;
  const finalized = items.filter(i => i.isFinalClosed).length;
  const gpsIssues = items.filter(i => i.isGpsModified).length;

  return (
    <div style={s.page}>
      <h1 style={s.title}>근태 현황</h1>

      {/* 요약 */}
      <div style={s.summaryGrid}>
        {[
          { label: "전체 기록", value: total, color: "#333" },
          { label: "출근 완료", value: clockedIn, color: "#2e7d32" },
          { label: "최종 종료", value: finalized, color: "#5865F2" },
          { label: "GPS 이탈", value: gpsIssues, color: "#f57c00" },
        ].map((item, i) => (
          <div key={i} style={s.summaryCard}>
            <p style={{ ...s.summaryNum, color: item.color }}>{item.value}</p>
            <p style={s.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* 검색 필터 */}
      <div style={s.filterRow}>
        <input
          type="month"
          value={yearMonth}
          onChange={e => setYearMonth(e.target.value)}
          style={s.monthInput}
        />
        <input
          style={s.searchInput}
          placeholder="직무지도원 이름 / 현장명 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchData()}
        />
        <button style={s.searchBtn} onClick={fetchData}>검색</button>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div style={s.loadingWrap}>
          <div style={s.spinner} />
          <p style={{ color: "#888", marginTop: 12 }}>로딩 중...</p>
        </div>
      ) : items.length === 0 ? (
        <p style={s.empty}>해당 기간에 근태 기록이 없습니다.</p>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>날짜</th>
                <th style={s.th}>직무지도원</th>
                <th style={s.th}>현장</th>
                <th style={s.th}>출근</th>
                <th style={s.th}>퇴근</th>
                <th style={s.th}>상태</th>
                <th style={s.th}>GPS</th>
                <th style={s.th}>출근 거리</th>
              </tr>
            </thead>
            <tbody>
              {items.map(row => {
                const st = STATUS_MAP[row.status] || STATUS_MAP.BEFORE;
                return (
                  <tr key={row.id} style={s.tr}>
                    <td style={s.td}>{row.workDate}</td>
                    <td style={s.td}>
                      <strong>{row.user?.userName || "-"}</strong>
                      <div style={{ fontSize: 12, color: "#aaa" }}>{row.user?.phoneNumber}</div>
                    </td>
                    <td style={s.td}>{row.site?.companyName || "-"}</td>
                    <td style={s.td}>
                      <span style={{ color: row.startTime ? "#2e7d32" : "#ccc" }}>
                        {formatTime(row.startTime)}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={{ color: row.endTime ? "#333" : "#ccc" }}>
                        {formatTime(row.endTime)}
                      </span>
                    </td>
                    <td style={s.td}>
                      <span style={{
                        fontSize: 12, fontWeight: 700,
                        color: st.color,
                        backgroundColor: st.bg,
                        padding: "3px 8px", borderRadius: 20,
                      }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={s.td}>
                      {row.isGpsModified ? (
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#f57c00", backgroundColor: "#fff8e1", padding: "3px 8px", borderRadius: 20 }}>
                          이탈
                        </span>
                      ) : row.withinRange === true ? (
                        <span style={{ fontSize: 12, color: "#2e7d32" }}>✓ 정상</span>
                      ) : (
                        <span style={{ color: "#ccc", fontSize: 12 }}>-</span>
                      )}
                    </td>
                    <td style={s.td}>
                      {row.startDistanceM != null ? (
                        <span style={{ color: row.startDistanceM > (row.withinRange ? 0 : 100) ? "#f57c00" : "#333" }}>
                          {Math.round(row.startDistanceM)}m
                        </span>
                      ) : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24 },
  title: { fontSize: 20, fontWeight: 800, color: "#111", margin: "0 0 20px" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 20 },
  summaryCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  summaryNum: { fontSize: 28, fontWeight: 800, margin: "0 0 4px" },
  summaryLabel: { fontSize: 13, color: "#888", margin: 0 },
  filterRow: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" as const },
  monthInput: { height: 40, border: "1px solid #ddd", borderRadius: 8, padding: "0 12px", fontSize: 14, outline: "none" },
  searchInput: { flex: 1, minWidth: 200, height: 40, border: "1px solid #ddd", borderRadius: 8, padding: "0 14px", fontSize: 14, outline: "none" },
  searchBtn: { padding: "0 20px", height: 40, backgroundColor: "#5865F2", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  loadingWrap: { display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 0" },
  spinner: { width: 36, height: 36, border: "3px solid #e0e5ff", borderTop: "3px solid #5865F2", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  empty: { textAlign: "center", color: "#aaa", padding: "40px 0" },
  tableWrap: { overflowX: "auto", backgroundColor: "#fff", borderRadius: 14, boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  table: { width: "100%", borderCollapse: "collapse" },
  thead: { backgroundColor: "#f8f9ff" },
  th: { padding: "12px 16px", textAlign: "left" as const, fontSize: 13, fontWeight: 700, color: "#555", borderBottom: "1px solid #eee", whiteSpace: "nowrap" as const },
  tr: { borderBottom: "1px solid #f5f5f5" },
  td: { padding: "12px 16px", fontSize: 14, color: "#333", verticalAlign: "middle" as const },
};
