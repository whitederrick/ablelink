"use client";
import { useEffect, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { sharedStyles } from "../_styles";

const AttendanceMap = dynamic(() => import("./AttendanceMap"), { ssr: false });

type AttendanceItem = {
  id: string; workDate: string;
  startTime: string | null; endTime: string | null;
  isFinalClosed: boolean; isGpsModified: boolean;
  status: string;
  startLocLat: string | null; startLocLon: string | null;
  endLocLat: string | null;   endLocLon: string | null;
  startDistanceM: number | null; endDistanceM: number | null;
  withinRange: boolean | null; rangeM: number | null;
  site: { companyName: string } | null;
  user: { userName: string; phoneNumber: string } | null;
};

type ViewMode = "list" | "map" | "monthly";

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
function daysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// ── 월별 히트맵 컴포넌트 ──────────────────────────────────────────────
function MonthlyView({ items, yearMonth }: { items: AttendanceItem[]; yearMonth: string }) {
  const days = daysInMonth(yearMonth);
  const dayNums = Array.from({ length: days }, (_, i) => i + 1);

  // coach별 그룹
  const coaches = useMemo(() => {
    const map = new Map<string, { name: string; site: string; byDay: Map<string, AttendanceItem> }>();
    for (const item of items) {
      const uid = item.user?.userName || item.id;
      if (!map.has(uid)) {
        map.set(uid, { name: uid, site: item.site?.companyName || "-", byDay: new Map() });
      }
      const day = item.workDate.slice(8); // "DD"
      map.get(uid)!.byDay.set(day, item);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  if (coaches.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 200, background: "#f9fafb", borderRadius: 12, border: "1px solid #e5e7eb" }}>
        <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>해당 기간에 근태 기록이 없습니다.</p>
      </div>
    );
  }

  function cellColor(item?: AttendanceItem): string {
    if (!item) return "#f3f4f6";
    if (item.isGpsModified) return "#fed7aa";
    if (!item.startTime) return "#fee2e2";
    if (!item.isFinalClosed) return "#fef9c3";
    return "#bbf7d0";
  }
  function cellLabel(item?: AttendanceItem): string {
    if (!item || !item.startTime) return "-";
    if (item.isGpsModified) return "⚠";
    if (!item.isFinalClosed) return "▷";
    return "✓";
  }
  function cellTextColor(item?: AttendanceItem): string {
    if (!item || !item.startTime) return "#d1d5db";
    if (item.isGpsModified) return "#c2410c";
    if (!item.isFinalClosed) return "#a16207";
    return "#16a34a";
  }

  // DOW header for yearMonth
  const [y, m] = yearMonth.split("-").map(Number);
  const dayOfWeek = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 900 }}>
        {/* 범례 */}
        <div style={{ display: "flex", gap: 14, marginBottom: 12, fontSize: 12, color: "#6b7280" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#bbf7d0" }} />정상 종료
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fef9c3" }} />미종료
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fed7aa" }} />GPS이탈
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fee2e2" }} />미출근
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#f3f4f6" }} />기록없음
          </span>
        </div>

        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ padding: "6px 10px", background: "#f9fafb", border: "1px solid #e5e7eb", textAlign: "left", minWidth: 100, position: "sticky", left: 0, zIndex: 1, fontSize: 12, color: "#374151" }}>직무지도원</th>
              <th style={{ padding: "4px", background: "#f9fafb", border: "1px solid #e5e7eb", textAlign: "center", minWidth: 70, position: "sticky", left: 100, zIndex: 1, fontSize: 12, color: "#374151" }}>현장</th>
              {dayNums.map(d => {
                const dow = new Date(y, m - 1, d).getDay();
                const isSun = dow === 0, isSat = dow === 6;
                return (
                  <th key={d} style={{ padding: "4px 2px", background: "#f9fafb", border: "1px solid #e5e7eb", textAlign: "center", minWidth: 28, color: isSun ? "#dc2626" : isSat ? "#2563eb" : "#374151" }}>
                    <div style={{ fontWeight: 700 }}>{d}</div>
                    <div style={{ fontSize: 10, fontWeight: 400, color: isSun ? "#dc2626" : isSat ? "#2563eb" : "#9ca3af" }}>{dayOfWeek[dow]}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {coaches.map(coach => (
              <tr key={coach.name}>
                <td style={{ padding: "5px 10px", border: "1px solid #e5e7eb", fontWeight: 600, color: "#111827", position: "sticky", left: 0, background: "#fff", zIndex: 1, whiteSpace: "nowrap" }}>
                  {coach.name}
                </td>
                <td style={{ padding: "5px 6px", border: "1px solid #e5e7eb", color: "#6b7280", position: "sticky", left: 100, background: "#fff", zIndex: 1, whiteSpace: "nowrap", fontSize: 11 }}>
                  {coach.site}
                </td>
                {dayNums.map(d => {
                  const key = pad2(d);
                  const item = coach.byDay.get(key);
                  return (
                    <td key={d} style={{ padding: 2, border: "1px solid #e5e7eb", textAlign: "center", background: cellColor(item) }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: cellTextColor(item) }}>{cellLabel(item)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 메인 페이지 ──────────────────────────────────────────────────────
export default function AttendancesPage() {
  const T = sharedStyles();
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
      const params = new URLSearchParams({ from, to, pageSize: "500", page: "1" });
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

  const tabBtn = (mode: ViewMode, label: string) => (
    <button onClick={() => setViewMode(mode)} style={{
      padding: "7px 18px", borderRadius: 8, border: "1px solid",
      borderColor: viewMode === mode ? "#111827" : "#e5e7eb",
      background: viewMode === mode ? "#111827" : "#fff",
      color: viewMode === mode ? "#fff" : "#374151",
      fontWeight: 600, fontSize: 13, cursor: "pointer",
    }}>{label}</button>
  );

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

      {/* 필터 + 탭 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input type="month" value={yearMonth} onChange={e => setYearMonth(e.target.value)}
          style={{ ...T.input, flex: "none", width: "auto" }} />
        <input style={T.input} placeholder="직무지도원 이름 / 현장명 검색"
          value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && fetchData()} />
        <button style={T.btnSecondary} onClick={fetchData}>검색</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {tabBtn("list", "📋 목록")}
          {tabBtn("map", "🗺 지도")}
          {tabBtn("monthly", "📅 월별현황")}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 10px" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>로딩 중...</p>
        </div>
      ) : viewMode === "map" ? (
        <AttendanceMap items={items} />
      ) : viewMode === "monthly" ? (
        <MonthlyView items={items} yearMonth={yearMonth} />
      ) : (
        /* 목록 뷰 */
        items.length === 0 ? (
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
        )
      )}
    </div>
  );
}
