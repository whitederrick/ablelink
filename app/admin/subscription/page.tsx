"use client";
// app/admin/subscription/page.tsx
// 구독 관리 페이지 — 에이전시별 구독 현황

import { useEffect, useState } from "react";

interface AgencySub {
  id: string;
  name: string;
  planType: string;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  subscribedAt: string | null;
  nextBillingAt: string | null;
  maxCoaches: number;
  maxSites: number;
  currentCoaches: number;
  currentSites: number;
}

const PLAN_LABELS: Record<string, string> = {
  FREE: "무료", TRIAL: "체험중", STARTER: "스타터", STANDARD: "스탠다드", PRO: "프로",
};
const PLAN_COLORS: Record<string, string> = {
  FREE: "#888", TRIAL: "#f57c00", STARTER: "#5865F2", STANDARD: "#1565c0", PRO: "#2e7d32",
};
const PLAN_BG: Record<string, string> = {
  FREE: "#f5f5f5", TRIAL: "#fff8e1", STARTER: "#f0f2ff", STANDARD: "#e3f2fd", PRO: "#e8f5e9",
};

export default function SubscriptionPage() {
  const [agencies, setAgencies] = useState<AgencySub[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/subscription")
      .then(r => r.json())
      .then(d => { if (d.success) setAgencies(d.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleChangePlan(agencyId: string, planType: string) {
    const res = await fetch(`/api/admin/subscription/${agencyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planType }),
    });
    const data = await res.json();
    if (data.success) {
      setAgencies(prev => prev.map(a =>
        a.id === agencyId ? { ...a, planType } : a
      ));
      alert("플랜이 변경되었습니다.");
    } else {
      alert(data.message || "변경 실패");
    }
  }

  const trialCount = agencies.filter(a => a.planType === "TRIAL").length;
  const paidCount = agencies.filter(a => ["STARTER", "STANDARD", "PRO"].includes(a.planType)).length;
  const freeCount = agencies.filter(a => a.planType === "FREE").length;

  return (
    <div style={s.page}>
      <h1 style={s.title}>구독 관리</h1>

      {/* 요약 */}
      <div style={s.summaryGrid}>
        {[
          { label: "전체 에이전시", value: agencies.length, color: "#333" },
          { label: "무료", value: freeCount, color: "#888" },
          { label: "체험중", value: trialCount, color: "#f57c00" },
          { label: "유료 구독", value: paidCount, color: "#2e7d32" },
        ].map((item, i) => (
          <div key={i} style={s.summaryCard}>
            <p style={s.summaryNum} className={`color-${i}`}>{item.value}</p>
            <p style={s.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* 테이블 */}
      {loading ? (
        <p style={s.empty}>로딩 중...</p>
      ) : agencies.length === 0 ? (
        <p style={s.empty}>등록된 에이전시가 없습니다.</p>
      ) : (
        <div style={s.tableWrap}>
          {agencies.map(a => (
            <div key={a.id} style={s.agencyCard}>
              <div style={s.cardTop}>
                <div>
                  <span style={s.agencyName}>{a.name}</span>
                  <span style={{
                    ...s.planBadge,
                    backgroundColor: PLAN_BG[a.planType] || "#f5f5f5",
                    color: PLAN_COLORS[a.planType] || "#888",
                  }}>
                    {PLAN_LABELS[a.planType] || a.planType}
                  </span>
                </div>
                <select
                  style={s.planSelect}
                  value={a.planType}
                  onChange={e => handleChangePlan(a.id, e.target.value)}
                >
                  {Object.entries(PLAN_LABELS).map(([val, label]) => (
                    <option key={val} value={val}>{label}</option>
                  ))}
                </select>
              </div>

              <div style={s.cardInfo}>
                <div style={s.infoItem}>
                  <span style={s.infoLabel}>직무지도원</span>
                  <span style={s.infoValue}>
                    {a.currentCoaches}명
                    {a.maxCoaches > 0 ? ` / ${a.maxCoaches}명` : " (무제한)"}
                  </span>
                </div>
                <div style={s.infoItem}>
                  <span style={s.infoLabel}>Site</span>
                  <span style={s.infoValue}>
                    {a.currentSites}개
                    {a.maxSites > 0 ? ` / ${a.maxSites}개` : " (무제한)"}
                  </span>
                </div>
                {a.planType === "TRIAL" && a.trialEndsAt && (
                  <div style={s.infoItem}>
                    <span style={s.infoLabel}>체험 만료</span>
                    <span style={{
                      ...s.infoValue,
                      color: new Date(a.trialEndsAt) < new Date() ? "#e53935" : "#f57c00",
                      fontWeight: 700,
                    }}>
                      {a.trialEndsAt.slice(0, 10)}
                      {new Date(a.trialEndsAt) < new Date() ? " (만료)" : ""}
                    </span>
                  </div>
                )}
                {a.subscribedAt && (
                  <div style={s.infoItem}>
                    <span style={s.infoLabel}>구독 시작</span>
                    <span style={s.infoValue}>{a.subscribedAt.slice(0, 10)}</span>
                  </div>
                )}
                {a.nextBillingAt && (
                  <div style={s.infoItem}>
                    <span style={s.infoLabel}>다음 결제</span>
                    <span style={s.infoValue}>{a.nextBillingAt.slice(0, 10)}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24 },
  title: { fontSize: 20, fontWeight: 800, color: "#111", margin: "0 0 20px" },
  summaryGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 },
  summaryCard: { backgroundColor: "#fff", borderRadius: 12, padding: "16px", textAlign: "center", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  summaryNum: { fontSize: 28, fontWeight: 800, color: "#333", margin: "0 0 4px" },
  summaryLabel: { fontSize: 13, color: "#888", margin: 0 },
  tableWrap: { display: "flex", flexDirection: "column", gap: 12 },
  agencyCard: { backgroundColor: "#fff", borderRadius: 14, padding: "16px 20px", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  agencyName: { fontSize: 16, fontWeight: 700, color: "#333", marginRight: 10 },
  planBadge: { fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 20 },
  planSelect: { padding: "6px 12px", border: "1.5px solid #eee", borderRadius: 8, fontSize: 13, cursor: "pointer", outline: "none" },
  cardInfo: { display: "flex", gap: 24, flexWrap: "wrap" as const },
  infoItem: { display: "flex", flexDirection: "column", gap: 2 },
  infoLabel: { fontSize: 12, color: "#888" },
  infoValue: { fontSize: 14, fontWeight: 600, color: "#333" },
  empty: { textAlign: "center", color: "#aaa", padding: "40px 0" },
};
