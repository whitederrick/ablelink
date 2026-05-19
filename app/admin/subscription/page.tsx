"use client";
import { useEffect, useState } from "react";
import { sharedStyles } from "../_styles";

interface AgencySub {
  id: string; name: string; planType: string;
  trialStartedAt: string | null; trialEndsAt: string | null;
  subscribedAt: string | null; nextBillingAt: string | null;
  maxCoaches: number; maxSites: number;
  currentCoaches: number; currentSites: number;
}

const PLAN: Record<string, { label: string; color: string; bg: string }> = {
  FREE:     { label: "무료",    color: "#6b7280", bg: "#f9fafb" },
  TRIAL:    { label: "체험중",  color: "#d97706", bg: "#fffbeb" },
  STARTER:  { label: "스타터",  color: "#2563eb", bg: "#eff6ff" },
  STANDARD: { label: "스탠다드", color: "#7c3aed", bg: "#f5f3ff" },
  PRO:      { label: "프로",    color: "#16a34a", bg: "#f0fdf4" },
};

export default function SubscriptionPage() {
  const T = sharedStyles();
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
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planType }),
    });
    const data = await res.json();
    if (data.success) {
      setAgencies(prev => prev.map(a => a.id === agencyId ? { ...a, planType } : a));
    } else { alert(data.message || "변경 실패"); }
  }

  const freeCount  = agencies.filter(a => a.planType === "FREE").length;
  const trialCount = agencies.filter(a => a.planType === "TRIAL").length;
  const paidCount  = agencies.filter(a => ["STARTER","STANDARD","PRO"].includes(a.planType)).length;

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={T.pageTitle}>구독 관리</h1>
      </div>

      {/* 요약 */}
      <div style={T.summaryGrid}>
        {[
          { label: "전체 에이전시", value: agencies.length, color: "#374151" },
          { label: "무료",          value: freeCount,        color: "#9ca3af" },
          { label: "체험중",        value: trialCount,       color: "#d97706" },
          { label: "유료 구독",     value: paidCount,        color: "#16a34a" },
        ].map((item, i) => (
          <div key={i} style={T.summaryCard}>
            <p style={{ ...T.summaryNum, color: item.color }}>{item.value}</p>
            <p style={T.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      {/* 에이전시 목록 */}
      {loading ? (
        <p style={T.empty}>로딩 중...</p>
      ) : agencies.length === 0 ? (
        <p style={T.empty}>등록된 에이전시가 없습니다.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {agencies.map(a => {
            const plan = PLAN[a.planType] || PLAN.FREE;
            const isTrialExpired = a.planType === "TRIAL" && a.trialEndsAt && new Date(a.trialEndsAt) < new Date();
            return (
              <div key={a.id} style={T.card}>
                {/* 상단: 기관명 + 플랜 + 변경 */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{a.name}</span>
                    <span style={{ ...T.badge, background: plan.bg, color: plan.color }}>{plan.label}</span>
                    {isTrialExpired && <span style={{ ...T.badge, background: "#fef2f2", color: "#dc2626" }}>만료</span>}
                  </div>
                  <select value={a.planType} onChange={e => handleChangePlan(a.id, e.target.value)}
                    style={{ padding: "6px 12px", border: "1px solid #e5e7eb", borderRadius: 8, fontSize: 12, cursor: "pointer", outline: "none", background: "#fff" }}>
                    {Object.entries(PLAN).map(([val, { label }]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                {/* 하단: 사용 현황 */}
                <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>직무지도원</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      {a.currentCoaches}명{a.maxCoaches > 0 ? ` / ${a.maxCoaches}명` : " (무제한)"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>Site</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
                      {a.currentSites}개{a.maxSites > 0 ? ` / ${a.maxSites}개` : " (무제한)"}
                    </div>
                  </div>
                  {a.trialEndsAt && (
                    <div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>체험 만료</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: isTrialExpired ? "#dc2626" : "#d97706" }}>
                        {a.trialEndsAt.slice(0, 10)}
                      </div>
                    </div>
                  )}
                  {a.nextBillingAt && (
                    <div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>다음 결제</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{a.nextBillingAt.slice(0, 10)}</div>
                    </div>
                  )}
                  {a.subscribedAt && (
                    <div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginBottom: 2 }}>구독 시작</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>{a.subscribedAt.slice(0, 10)}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
