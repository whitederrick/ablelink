"use client";
// app/admin/coaches/page.tsx
// 직무지도원 관리 페이지

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Coach {
  id: string;
  userName: string;
  phoneNumber: string;
  loginId: string;
  planType: string;
  status: string;
  createdAt: string;
  activeAssignment: {
    siteName: string;
    agencyName: string;
    startDate: string;
  } | null;
}

export default function CoachesPage() {
  const router = useRouter();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetch("/api/admin/coaches")
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.data)) {
          setCoaches(d.data);
          setTotal(d.total ?? d.data.length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = (coaches || []).filter(c =>
    c.userName.includes(search) ||
    c.phoneNumber.includes(search) ||
    c.activeAssignment?.siteName.includes(search) ||
    c.activeAssignment?.agencyName.includes(search)
  );

  const STATUS_LABEL: Record<string, string> = {
    ACTIVE: "활성", INACTIVE: "비활성", SUSPENDED: "정지",
  };
  const STATUS_COLOR: Record<string, string> = {
    ACTIVE: "#2e7d32", INACTIVE: "#888", SUSPENDED: "#e53935",
  };
  const PLAN_LABEL: Record<string, string> = {
    FREE: "무료", TRIAL: "체험", STARTER: "스타터", STANDARD: "스탠다드", PRO: "프로",
  };
  const PLAN_COLOR: Record<string, string> = {
    FREE: "#888", TRIAL: "#f57c00", STARTER: "#5865F2", STANDARD: "#5865F2", PRO: "#2e7d32",
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>직무지도원 관리</h1>
        <span style={s.total}>총 {total}명</span>
      </div>

      {/* 검색 */}
      <div style={s.searchRow}>
        <input
          style={s.searchInput}
          placeholder="이름 / 전화번호 / 현장명 / 기관명 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button style={s.searchBtn}>검색</button>
      </div>

      {/* 테이블 */}
      {loading ? (
        <p style={s.empty}>로딩 중...</p>
      ) : filtered.length === 0 ? (
        <p style={s.empty}>등록된 직무지도원이 없습니다.</p>
      ) : (
        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead>
              <tr style={s.thead}>
                <th style={s.th}>이름</th>
                <th style={s.th}>전화번호</th>
                <th style={s.th}>현장</th>
                <th style={s.th}>기관</th>
                <th style={s.th}>배정일</th>
                <th style={s.th}>플랜</th>
                <th style={s.th}>상태</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={s.tr}>
                  <td style={s.td}><strong>{c.userName}</strong></td>
                  <td style={s.td}>{c.phoneNumber}</td>
                  <td style={s.td}>{c.activeAssignment?.siteName || <span style={s.none}>미배정</span>}</td>
                  <td style={s.td}>{c.activeAssignment?.agencyName || "-"}</td>
                  <td style={s.td}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td style={s.td}>
                    <span style={{ ...s.planBadge, color: PLAN_COLOR[c.planType] || "#888" }}>
                      {PLAN_LABEL[c.planType] || c.planType}
                    </span>
                  </td>
                  <td style={s.td}>
                    <span style={{ ...s.statusDot, backgroundColor: STATUS_COLOR[c.status] || "#888" }} />
                    {STATUS_LABEL[c.status] || c.status}
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

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24 },
  header: { display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 },
  title: { fontSize: 20, fontWeight: 800, color: "#111", margin: 0 },
  total: { fontSize: 14, color: "#888" },
  searchRow: { display: "flex", gap: 8, marginBottom: 16 },
  searchInput: { flex: 1, height: 40, border: "1px solid #ddd", borderRadius: 8, padding: "0 14px", fontSize: 14, outline: "none" },
  searchBtn: { padding: "0 20px", backgroundColor: "#5865F2", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", backgroundColor: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  thead: { backgroundColor: "#f8f9ff" },
  th: { padding: "12px 16px", textAlign: "left" as const, fontSize: 13, fontWeight: 700, color: "#555", borderBottom: "1px solid #eee" },
  tr: { borderBottom: "1px solid #f5f5f5" },
  td: { padding: "12px 16px", fontSize: 14, color: "#333", verticalAlign: "middle" as const },
  planBadge: { fontWeight: 700, fontSize: 13 },
  statusDot: { display: "inline-block", width: 8, height: 8, borderRadius: "50%", marginRight: 6 },
  none: { color: "#ccc", fontStyle: "italic" },
  empty: { textAlign: "center", color: "#aaa", padding: "40px 0" },
};
