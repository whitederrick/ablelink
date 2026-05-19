"use client";
import { useEffect, useState } from "react";
import { sharedStyles } from "../_styles";

type AttendanceItem = {
  id: string; workDate: string;
  startTime: string | null; endTime: string | null;
  isFinalClosed: boolean; isGpsModified: boolean;
  status: string; startDistanceM: number | null;
  endDistanceM: number | null; withinRange: boolean | null;
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

export default function AttendancesPage() {
  const T = sharedStyles();
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
      const to = `${yearMonth}-${pad2(new Date(y, m, 0).getDate())}`;
      const params = new URLSearchParams({ from, to, pageSize: "200", page: "1" });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/admin/attendances?${params}`);
      const data = await res.json();
      if (data.success) { setItems(data.items || []); setTotal(data.total || 0); }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { fetchData(); }, [yearMonth]);

  const clockedIn = items.filter(i => i.startTime).length;
  const finalized = items.filter(i => i.isFinalClosed).length;
  const gpsIssues = items.filter(i => i.isGpsModified).length;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={T.pageTitle}>근태 현황</h1>
      </div>

      {/* 요약 카드 */}
      <div style={T.summaryGrid}>
        {[
          { label: "전체 기록", value: total,     color: "#374151" },
          { label: "출근 완료", value: clockedIn,  color: "#2563eb" },
          { label: "최종 종료", value: finalized,  color: "#16a34a" },
          { label: "GPS 이탈",  value: gpsIssues,  color: "#ea580c" },
        ].map((item, i) => (
          <div key={i} style={T.summaryCard}>
            <p style={{ ...T.summaryNum, color: item.color }}>{item.value}</p>
            <p style={T.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* 검색 필터 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)}
          style={{ ...T.input, flex: "none", width: "auto" }} />
        <input style={T.input} placeholder="직무지도원 이름 / 현장명 검색"
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchData()} />
        <button style={T.btnSecondary} onClick={fetchData}>검색</button>
      </div>

      {/* 테이블 */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 10px" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>로딩 중...</p>
        </div>
      ) : items.length === 0 ? (
        <div style={T.tableWrap}><p style={T.empty}>해당 기간에 근태 기록이 없습니다.</p></div>
      ) : (
        <div style={T.tableWrap}>
          <table style={T.table}>
            <thead>
              <tr>
                {["날짜", "직무지도원", "현장", "출근", "퇴근", "상태", "GPS", "출근 거리"].map(h => (
                  <th key={h} style={T.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(row => (
                <tr key={row.id} style={T.tr}>
                  <td style={{ ...T.td, color: "#6b7280", fontSize: 12 }}>{row.workDate}</td>
                  <td style={T.td}>
                    <div style={{ fontWeight: 600, color: "#111827" }}>{row.user?.userName || "-"}</div>
                    <div style={{ fontSize: 12, color: "#9ca3af" }}>{row.user?.phoneNumber}</div>
                  </td>
                  <td style={T.td}>{row.site?.companyName || "-"}</td>
                  <td style={{ ...T.td, color: row.startTime ? "#16a34a" : "#d1d5db" }}>
                    {formatTime(row.startTime)}
                  </td>
                  <td style={{ ...T.td, color: row.endTime ? "#374151" : "#d1d5db" }}>
                    {formatTime(row.endTime)}
                  </td>
                  <td style={T.td}>
                    {row.isFinalClosed
                      ? <span style={{ ...T.badge, background: "#f0fdf4", color: "#16a34a" }}>종료</span>
                      : row.startTime
                      ? <span style={{ ...T.badge, background: "#eff6ff", color: "#2563eb" }}>근무중</span>
                      : <span style={{ ...T.badge, background: "#f9fafb", color: "#9ca3af" }}>출근전</span>}
                  </td>
                  <td style={T.td}>
                    {row.isGpsModified
                      ? <span style={{ ...T.badge, background: "#fff7ed", color: "#ea580c" }}>이탈</span>
                      : row.withinRange === true
                      ? <span style={{ fontSize: 12, color: "#16a34a" }}>정상</span>
                      : <span style={{ color: "#d1d5db", fontSize: 12 }}>-</span>}
                  </td>
                  <td style={{ ...T.td, color: row.startDistanceM && row.startDistanceM > 100 ? "#ea580c" : "#374151" }}>
                    {row.startDistanceM != null ? `${Math.round(row.startDistanceM)}m` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
