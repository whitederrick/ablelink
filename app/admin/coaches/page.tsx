"use client";
import { useEffect, useState } from "react";
import { sharedStyles } from "../_styles";

interface Coach {
  id: string;
  userName: string;
  phoneNumber: string;
  loginId: string;
  planType: string;
  status: string;
  createdAt: string;
  activeAssignment: { siteName: string; agencyName: string; startDate: string; } | null;
}

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  ACTIVE:   { label: "활성",   color: "#16a34a", bg: "#f0fdf4" },
  RESIGNED: { label: "퇴사",   color: "#6b7280", bg: "#f9fafb" },
  PAUSED:   { label: "일시정지", color: "#d97706", bg: "#fffbeb" },
};
const PLAN: Record<string, { label: string; color: string; bg: string }> = {
  FREE:     { label: "무료",   color: "#6b7280", bg: "#f9fafb" },
  PREMIUM:  { label: "프리미엄", color: "#7c3aed", bg: "#f5f3ff" },
};

export default function CoachesPage() {
  const T = sharedStyles();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetch("/api/admin/coaches")
      .then(r => r.json())
      .then(d => { if (d.success && Array.isArray(d.data)) { setCoaches(d.data); setTotal(d.total ?? d.data.length); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = coaches.filter(c =>
    c.userName.includes(search) ||
    c.phoneNumber.includes(search) ||
    c.activeAssignment?.siteName.includes(search) ||
    c.loginId.includes(search)
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={T.pageTitle}>직무지도원 관리</h1>
          <p style={T.pageSub}>총 {total}명</p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="이름 / 전화번호 / 현장명 / 아이디 검색" style={T.input} />
      </div>

      <div style={T.tableWrap}>
        <table style={T.table}>
          <thead>
            <tr>
              {["이름", "전화번호", "아이디", "현장", "기관", "배정일", "플랜", "상태"].map(h => (
                <th key={h} style={T.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={T.tdCenter}>로딩 중...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={T.tdCenter}>직무지도원이 없습니다.</td></tr>
            ) : filtered.map(c => {
              const status = STATUS[c.status] || { label: c.status, color: "#6b7280", bg: "#f9fafb" };
              const plan = PLAN[c.planType] || { label: c.planType, color: "#6b7280", bg: "#f9fafb" };
              return (
                <tr key={c.id} style={T.tr}>
                  <td style={T.td}><strong style={{ color: "#111827" }}>{c.userName}</strong></td>
                  <td style={{ ...T.td, color: "#6b7280" }}>{c.phoneNumber}</td>
                  <td style={{ ...T.td, color: "#9ca3af", fontSize: 12 }}>{c.loginId}</td>
                  <td style={T.td}>
                    {c.activeAssignment?.siteName
                      ? <span style={{ color: "#374151" }}>{c.activeAssignment.siteName}</span>
                      : <span style={{ color: "#d1d5db", fontStyle: "italic" }}>미배정</span>}
                  </td>
                  <td style={{ ...T.td, color: "#6b7280" }}>{c.activeAssignment?.agencyName || "-"}</td>
                  <td style={{ ...T.td, color: "#9ca3af", fontSize: 12 }}>{c.activeAssignment?.startDate?.slice(0, 10) || "-"}</td>
                  <td style={T.td}>
                    <span style={{ ...T.badge, background: plan.bg, color: plan.color }}>{plan.label}</span>
                  </td>
                  <td style={T.td}>
                    <span style={{ ...T.badge, background: status.bg, color: status.color }}>{status.label}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
