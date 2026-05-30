"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Check, ChevronLeft, CreditCard, Gift, Shield, Sparkles } from "lucide-react";

const PLANS = [
  {
    id: "STARTER",
    name: "스타터",
    price: 50000,
    maxWorkers: 5,
    maxSites: 5,
    features: [
      "직무지도원 최대 5명",
      "현장(Site) 최대 5개",
      "AI 음성 일지 변환",
      "PDF 자동 생성",
      "전자서명",
      "이메일 자동 발송",
    ],
    recommended: false,
  },
  {
    id: "STANDARD",
    name: "스탠다드",
    price: 90000,
    maxWorkers: 20,
    maxSites: 20,
    features: [
      "직무지도원 최대 20명",
      "현장(Site) 최대 20개",
      "스타터 모든 기능",
      "정산/급여 리포트",
      "우선 고객 지원",
    ],
    recommended: true,
  },
  {
    id: "PRO",
    name: "프로",
    price: 150000,
    maxWorkers: 0,
    maxSites: 0,
    features: [
      "직무지도원 무제한",
      "현장(Site) 무제한",
      "스탠다드 모든 기능",
      "전담 고객 지원",
      "맞춤 기능 개발 협의",
    ],
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
      <Script src="https://js.tosspayments.com/v1/payment" onLoad={() => setTossLoaded(true)} />

      <div className="min-h-dvh bg-slate-50 pb-10">
        {/* 헤더 */}
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-4">
          <button
            onClick={() => router.back()}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          </button>
          <h1 className="text-base font-black text-slate-900">구독 플랜</h1>
          <div className="w-9" />
        </header>

        <div className="mx-auto max-w-md space-y-3 px-4 py-4">

          {/* 현재 상태 배너 */}
          {isTrial && trialEndsAt && (
            <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Gift className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-black text-amber-700">무료 체험 중</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-amber-600">
                  {new Date(trialEndsAt).toLocaleDateString("ko-KR")}까지 PREMIUM 기능을 무료로 사용 중이에요.
                  만료 전에 구독을 시작하시면 끊김 없이 사용할 수 있어요.
                </p>
              </div>
            </div>
          )}

          {isPaid && (
            <div className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-500" aria-hidden="true" />
                <p className="text-sm font-black text-emerald-700">
                  현재 구독 중: {PLANS.find(p => p.id === currentPlan)?.name || currentPlan}
                </p>
              </div>
              <button
                onClick={handleCancel}
                className="rounded-xl border border-rose-300 bg-white px-3 py-1.5 text-xs font-black text-rose-600 transition active:scale-95"
              >
                해지
              </button>
            </div>
          )}

          {!isTrial && !isPaid && (
            <div className="flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-500" aria-hidden="true" />
              <div>
                <p className="text-sm font-black text-sky-700">현재 무료 플랜</p>
                <p className="mt-1 text-xs font-semibold leading-relaxed text-sky-600">
                  구독하시면 AI 음성 일지, PDF 자동 생성, 전자서명 등 PREMIUM 기능을 사용할 수 있어요.
                </p>
              </div>
            </div>
          )}

          {/* 플랜 카드 */}
          {PLANS.map(plan => {
            const isCurrentPlan = currentPlan === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border-2 bg-white p-5 ${
                  plan.recommended ? "border-slate-950" : "border-slate-100"
                }`}
              >
                {plan.recommended && (
                  <div className="absolute -top-3 right-4 rounded-full bg-slate-950 px-3 py-0.5 text-[11px] font-black text-white">
                    추천
                  </div>
                )}

                <p className={`text-lg font-black ${plan.recommended ? "text-slate-950" : "text-slate-700"}`}>
                  {plan.name}
                </p>
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900">{plan.price.toLocaleString()}</span>
                  <span className="text-sm font-semibold text-slate-400">원/월</span>
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  직무지도원 {plan.maxWorkers === 0 ? "무제한" : `최대 ${plan.maxWorkers}명`} ·
                  현장 {plan.maxSites === 0 ? "무제한" : `최대 ${plan.maxSites}개`}
                </p>

                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  {plan.features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Check className="h-3.5 w-3.5 flex-shrink-0 text-slate-950" aria-hidden="true" />
                      <span className="text-sm font-semibold text-slate-700">{f}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => !isCurrentPlan && handleSubscribe(plan.id)}
                  disabled={isCurrentPlan || loading}
                  className={`mt-4 min-h-12 w-full rounded-xl text-sm font-black transition active:scale-[0.97] disabled:opacity-60 ${
                    isCurrentPlan
                      ? "bg-slate-100 text-slate-400"
                      : "bg-slate-950 text-white shadow-lg shadow-slate-950/20"
                  }`}
                >
                  {isCurrentPlan ? "현재 플랜" : loading ? "처리 중..." : "구독 시작"}
                </button>
              </div>
            );
          })}

          {/* 안내 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <CreditCard className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden="true" />
              카드 등록 후 매월 자동 결제됩니다.
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Shield className="h-4 w-4 flex-shrink-0 text-slate-400" aria-hidden="true" />
              결제 정보는 토스페이먼츠를 통해 안전하게 처리됩니다.
            </div>
            <p className="text-xs font-semibold text-slate-400 pl-6">
              문의: able-link.co.kr
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
