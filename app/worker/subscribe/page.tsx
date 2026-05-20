"use client";
// app/worker/subscribe/page.tsx
// 에이전시 구독 결제 페이지 (토스페이먼츠)

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";

const PLANS = [
  {
    id: "STARTER",
    name: "스타터",
    price: 30000,
    maxCoaches: 5,
    maxSites: 5,
    features: [
      "직무지도원 최대 5명",
      "현장(Site) 최대 5개",
      "AI 음성 일지 변환",
      "PDF 자동 생성",
      "전자서명",
      "이메일 자동 발송",
    ],
    color: "#2563eb",
    recommended: false,
  },
  {
    id: "STANDARD",
    name: "스탠다드",
    price: 80000,
    maxCoaches: 20,
    maxSites: 20,
    features: [
      "직무지도원 최대 20명",
      "현장(Site) 최대 20개",
      "스타터 모든 기능",
      "정산/급여 리포트",
      "우선 고객 지원",
    ],
    color: "#1565c0",
    recommended: true,
  },
  {
    id: "PRO",
    name: "프로",
    price: 150000,
    maxCoaches: 0,
    maxSites: 0,
    features: [
      "직무지도원 무제한",
      "현장(Site) 무제한",
      "스탠다드 모든 기능",
      "전담 고객 지원",
      "맞춤 기능 개발 협의",
    ],
    color: "#2e7d32",
    recommended: false,
  },
];

declare global {
  interface Window {
    TossPayments: any;
  }
}

export default function SubscribePage() {
  const router = useRouter();
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string>("FREE");
  const [selectedPlan, setSelectedPlan] = useState<string>("STANDARD");
  const [loading, setLoading] = useState(false);
  const [tossLoaded, setTossLoaded] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);

  useEffect(() => {
    // 현재 에이전시 구독 현황 조회
    fetch("/api/worker/site/current")
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data) {
          setAgencyId(d.data.agencyId || null);
          setCurrentPlan(d.data.agencyPlanType || "FREE");
          setTrialEndsAt(d.data.trialEndsAt || null);
        }
      });
  }, []);

  async function handleSubscribe(planId: string) {
    if (!tossLoaded) {
      alert("결제 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (!agencyId) {
      alert("에이전시 정보를 찾을 수 없습니다. 현장 등록 후 이용해주세요.");
      return;
    }

    setLoading(true);
    try {
      const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "";
      const tossPayments = window.TossPayments(clientKey);

      const customerKey = `agency_${agencyId}`;

      await tossPayments.requestBillingAuth("카드", {
        customerKey,
        successUrl: `${window.location.origin}/worker/subscribe/success?planType=${planId}&agencyId=${agencyId}&customerKey=${customerKey}`,
        failUrl: `${window.location.origin}/worker/subscribe/fail`,
      });
    } catch (err: any) {
      if (err.code !== "USER_CANCEL") {
        alert(err.message || "결제 중 오류가 발생했습니다.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    if (!confirm("구독을 해지하시겠습니까?\n해지 후 PREMIUM 기능을 사용할 수 없습니다.")) return;
    if (!agencyId) return;

    const res = await fetch("/api/payments/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agencyId }),
    });
    const data = await res.json();
    if (data.success) {
      alert("구독이 해지되었습니다.");
      router.refresh();
    } else {
      alert(data.message || "해지에 실패했습니다.");
    }
  }

  const isPaid = ["STARTER", "STANDARD", "PRO"].includes(currentPlan);
  const isTrial = currentPlan === "TRIAL";

  return (
    <>
      <Script
        src="https://js.tosspayments.com/v1/payment"
        onLoad={() => setTossLoaded(true)}
      />

      <div style={s.page}>
        <div style={s.container}>
          {/* 헤더 */}
          <div style={s.header}>
            <button onClick={() => router.back()} style={s.backBtn}>←</button>
            <h1 style={s.title}>구독 플랜</h1>
            <div style={{ width: 36 }} />
          </div>

          {/* 현재 상태 */}
          <div style={s.currentBox}>
            {isTrial && trialEndsAt && (
              <div style={s.trialBanner}>
                <p style={s.trialTitle}>🎁 무료 체험 중</p>
                <p style={s.trialDesc}>
                  {new Date(trialEndsAt).toLocaleDateString("ko-KR")}까지 PREMIUM 기능을 무료로 사용 중이에요.
                  만료 전에 구독을 시작하시면 끊김 없이 사용할 수 있어요.
                </p>
              </div>
            )}
            {isPaid && (
              <div style={s.paidBanner}>
                <p style={s.paidTitle}>
                  ✅ 현재 구독 중: {PLANS.find(p => p.id === currentPlan)?.name || currentPlan}
                </p>
                <button style={s.cancelBtn} onClick={handleCancel}>
                  구독 해지
                </button>
              </div>
            )}
            {!isTrial && !isPaid && (
              <div style={s.freeBanner}>
                <p style={s.freeTitle}>현재 무료 플랜</p>
                <p style={s.freeDesc}>구독하시면 AI 음성 일지, PDF 자동 생성, 전자서명 등 PREMIUM 기능을 사용할 수 있어요.</p>
              </div>
            )}
          </div>

          {/* 플랜 카드 */}
          <div style={s.plansGrid}>
            {PLANS.map(plan => {
              const isCurrentPlan = currentPlan === plan.id;
              return (
                <div key={plan.id} style={{
                  ...s.planCard,
                  borderColor: plan.recommended ? plan.color : "#eee",
                  borderWidth: plan.recommended ? 2 : 1,
                }}>
                  {plan.recommended && (
                    <div style={{ ...s.recommendBadge, backgroundColor: plan.color }}>
                      추천
                    </div>
                  )}
                  <p style={{ ...s.planName, color: plan.color }}>{plan.name}</p>
                  <p style={s.planPrice}>
                    <span style={s.planPriceNum}>{plan.price.toLocaleString()}</span>
                    <span style={s.planPriceUnit}>원/월</span>
                  </p>
                  <p style={s.planCapacity}>
                    직무지도원 {plan.maxCoaches === 0 ? "무제한" : `최대 ${plan.maxCoaches}명`} ·
                    현장 {plan.maxSites === 0 ? "무제한" : `최대 ${plan.maxSites}개`}
                  </p>

                  <div style={s.planFeatures}>
                    {plan.features.map((f, i) => (
                      <div key={i} style={s.planFeatureItem}>
                        <span style={{ color: plan.color }}>✓</span>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>

                  <button
                    style={{
                      ...s.subscribeBtn,
                      backgroundColor: isCurrentPlan ? "#f0f0f0" : plan.color,
                      color: isCurrentPlan ? "#888" : "#fff",
                      cursor: isCurrentPlan ? "default" : "pointer",
                      opacity: loading ? 0.7 : 1,
                    }}
                    onClick={() => !isCurrentPlan && handleSubscribe(plan.id)}
                    disabled={isCurrentPlan || loading}
                  >
                    {isCurrentPlan ? "현재 플랜" : loading ? "처리 중..." : "구독 시작"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* 안내 */}
          <div style={s.notice}>
            <p style={s.noticeText}>
              💳 카드 등록 후 매월 자동 결제됩니다.<br />
              🔒 결제 정보는 토스페이먼츠를 통해 안전하게 처리됩니다.<br />
              ❓ 문의사항이 있으시면 able-link.co.kr로 연락해주세요.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", backgroundColor: "#f9fafb" },
  container: { maxWidth: 480, margin: "0 auto", padding: "0 0 40px" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", backgroundColor: "#fff", borderBottom: "1px solid #eee", position: "sticky", top: 0, zIndex: 10 },
  backBtn: { background: "none", border: "none", fontSize: 22, cursor: "pointer", color: "#333", width: 36 },
  title: { fontSize: 18, fontWeight: 700, color: "#333", margin: 0 },

  currentBox: { margin: "12px 16px 0" },
  trialBanner: { backgroundColor: "#fff8e1", borderRadius: 12, padding: "14px 16px", border: "1px solid #ffe082" },
  trialTitle: { fontSize: 15, fontWeight: 700, color: "#f57c00", margin: "0 0 4px" },
  trialDesc: { fontSize: 13, color: "#666", margin: 0, lineHeight: 1.6 },
  paidBanner: { backgroundColor: "#e8f5e9", borderRadius: 12, padding: "14px 16px", border: "1px solid #a5d6a7", display: "flex", justifyContent: "space-between", alignItems: "center" },
  paidTitle: { fontSize: 14, fontWeight: 700, color: "#2e7d32", margin: 0 },
  cancelBtn: { padding: "6px 14px", backgroundColor: "#fff", border: "1.5px solid #e53935", borderRadius: 8, color: "#e53935", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  freeBanner: { backgroundColor: "#f0f2ff", borderRadius: 12, padding: "14px 16px", border: "1px solid #c7ceff" },
  freeTitle: { fontSize: 14, fontWeight: 700, color: "#2563eb", margin: "0 0 4px" },
  freeDesc: { fontSize: 13, color: "#666", margin: 0, lineHeight: 1.6 },

  plansGrid: { display: "flex", flexDirection: "column", gap: 12, margin: "16px 16px 0" },
  planCard: { backgroundColor: "#fff", borderRadius: 16, padding: "20px", border: "1px solid #eee", position: "relative" },
  recommendBadge: { position: "absolute", top: -10, right: 16, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 10 },
  planName: { fontSize: 18, fontWeight: 800, margin: "0 0 4px" },
  planPrice: { margin: "0 0 4px", display: "flex", alignItems: "baseline", gap: 2 },
  planPriceNum: { fontSize: 28, fontWeight: 800, color: "#333" },
  planPriceUnit: { fontSize: 14, color: "#888" },
  planCapacity: { fontSize: 12, color: "#888", margin: "0 0 14px" },
  planFeatures: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  planFeatureItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#444" },
  subscribeBtn: { width: "100%", padding: "13px", border: "none", borderRadius: 10, fontSize: 15, fontWeight: 700, transition: "opacity 0.2s" },

  notice: { margin: "16px 16px 0", padding: "14px 16px", backgroundColor: "#f9fafb", borderRadius: 12 },
  noticeText: { fontSize: 13, color: "#888", margin: 0, lineHeight: 1.8 },
};
