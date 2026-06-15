"use client";

// 위탁기관 구독 — 매니저가 본인 위탁기관 플랜을 조회하고 결제(Toss)로 구독/변경/해지.
// (이전 /worker/subscribe 결제 플로우를 매니저 콘솔로 이전)
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import { Check, Sparkles } from "lucide-react";
import { T } from "../_styles";
import PageHeader from "../_components/PageHeader";

interface AgencySub {
  id: string; name: string; planType: string;
  trialEndsAt: string | null; subscribedAt: string | null; nextBillingAt: string | null;
  maxWorkers: number; maxSites: number; currentWorkers: number; currentSites: number;
  billingCycle: string; customAmount: number | null;
}

// 가격·기능은 lib/planGuard.ts(게이트)·PLAN_LIMITS(한도)·payments/billing(PLAN_PRICES)과 정합 유지.
const PLANS = [
  {
    id: "STARTER", name: "스타터", price: 49000,
    features: [
      "직무지도원·현장 무제한",
      "출근부·일지 엑셀·CSV 내보내기",
      "문서 인박스(제출 추적)",
      "기록 보관 1년",
    ],
    recommended: false,
  },
  {
    id: "STANDARD", name: "스탠다드", price: 99000,
    features: [
      "스타터 모든 기능",
      "PDF 자동 생성·전자서명",
      "사업체담당자 모바일 서명",
      "AI 음성 일지(단일·일괄 월 1회)",
      "훈련생 진척도 리포트·감사 패키지",
    ],
    recommended: true,
  },
  {
    id: "PRO", name: "프로", price: 199000,
    features: [
      "스탠다드 모든 기능",
      "급여 자동계산",
      "전자 근로계약서",
      "매칭: 공고 자동배정 + 인재풀 소싱",
      "전담 지원·맞춤 온보딩",
    ],
    recommended: false,
  },
];

const PLAN_LABEL: Record<string, string> = {
  FREE: "무료", TRIAL: "체험중", STARTER: "스타터", STANDARD: "스탠다드", PRO: "프로",
};

declare global {
  interface Window { TossPayments: any; }
}

export default function SubscriptionPage() {
  const router = useRouter();
  const [agency, setAgency] = useState<AgencySub | null>(null);
  const [loading, setLoading] = useState(true);
  const [tossLoaded, setTossLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/subscription")
      .then(r => r.json())
      .then(d => { if (d.success) setAgency((d.data || [])[0] || null); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function subscribe(planId: string) {
    if (!tossLoaded) { alert("결제 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요."); return; }
    if (!agency) { alert("위탁기관 정보를 찾을 수 없습니다."); return; }
    setBusy(true);
    try {
      const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || "";
      const tossPayments = window.TossPayments(clientKey);
      const customerKey = `agency_${agency.id}`;
      await tossPayments.requestBillingAuth("카드", {
        customerKey,
        successUrl: `${window.location.origin}/manager/subscribe/success?planType=${planId}&agencyId=${agency.id}&customerKey=${customerKey}`,
        failUrl: `${window.location.origin}/manager/subscribe/fail`,
      });
    } catch (err: any) {
      if (err.code !== "USER_CANCEL") alert(err.message || "결제 중 오류가 발생했습니다.");
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!confirm("구독을 해지하시겠습니까?\n해지 후 유료 기능을 사용할 수 없고 무료 플랜 한도가 적용됩니다.")) return;
    const res = await fetch("/api/payments/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.success) { alert("구독이 해지되었습니다."); router.refresh(); location.reload(); }
    else alert(data.message || "해지에 실패했습니다.");
  }

  const plan = agency?.planType ?? "FREE";
  const isPaid = ["STARTER", "STANDARD", "PRO"].includes(plan);
  const isTrial = plan === "TRIAL";

  return (
    <>
      <Script src="https://js.tosspayments.com/v1/payment" onLoad={() => setTossLoaded(true)} />
      <div>
        <PageHeader
          title="구독 관리"
          sub="위탁기관 구독 플랜을 확인하고 변경합니다. 결제는 토스페이먼츠로 안전하게 처리됩니다."
        />

        {loading ? (
          <p className={T.empty}>불러오는 중…</p>
        ) : !agency ? (
          <p className={T.empty}>위탁기관 정보를 찾을 수 없습니다.</p>
        ) : (
          <div className="space-y-5">
            {/* 현재 상태 */}
            <div className={T.card}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-base font-black text-slate-900">{agency.name}</span>
                <span className={`${T.badge} ${isPaid ? "bg-emerald-50 text-emerald-600" : isTrial ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                  {PLAN_LABEL[plan] ?? plan}
                </span>
                {isPaid && (
                  <button onClick={cancel} className={`ml-auto ${T.btnDanger}`}>구독 해지</button>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-6 text-sm">
                <div>
                  <div className="text-xs font-semibold text-slate-400">직무지도원</div>
                  <div className="font-semibold text-slate-700">{agency.currentWorkers}명{agency.maxWorkers > 0 ? ` / ${agency.maxWorkers}명` : " (무제한)"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-400">현장(사업체)</div>
                  <div className="font-semibold text-slate-700">{agency.currentSites}개{agency.maxSites > 0 ? ` / ${agency.maxSites}개` : " (무제한)"}</div>
                </div>
                {agency.trialEndsAt && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400">체험 만료</div>
                    <div className="font-semibold text-amber-600">{agency.trialEndsAt.slice(0, 10)}</div>
                  </div>
                )}
                {agency.nextBillingAt && (
                  <div>
                    <div className="text-xs font-semibold text-slate-400">다음 결제</div>
                    <div className="font-semibold text-slate-700">{agency.nextBillingAt.slice(0, 10)}</div>
                  </div>
                )}
              </div>
              {agency.customAmount != null && agency.customAmount > 0 && (
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-3">
                  <Check className="h-4 w-4 flex-shrink-0 text-emerald-600" />
                  <p className="text-xs font-bold text-emerald-700">
                    운영자 협상가 적용: {agency.billingCycle === "ANNUAL" ? "연" : "월"} {agency.customAmount.toLocaleString()}원
                    <span className="ml-1 font-semibold text-emerald-600">(표준가 대신 이 금액으로 결제됩니다)</span>
                  </p>
                </div>
              )}
              {!isPaid && (
                <div className="mt-4 flex items-start gap-2 rounded-xl bg-sky-50 p-3">
                  <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-500" />
                  <p className="text-xs font-semibold leading-relaxed text-sky-700">
                    구독하시면 엑셀 내보내기·PDF·전자서명·AI 일지·급여·전자계약·매칭 등 유료 기능을 사용할 수 있어요.
                  </p>
                </div>
              )}
            </div>

            {/* 플랜 카드 */}
            <div className="grid gap-4 md:grid-cols-3">
              {PLANS.map(p => {
                const isCurrent = plan === p.id;
                return (
                  <div key={p.id} className={`relative rounded-2xl border-2 bg-white p-5 ${p.recommended ? "border-slate-950" : "border-slate-100"}`}>
                    {p.recommended && (
                      <div className="absolute -top-3 right-4 rounded-full bg-slate-950 px-3 py-0.5 text-[11px] font-black text-white">추천</div>
                    )}
                    <p className={`text-lg font-black ${p.recommended ? "text-slate-950" : "text-slate-700"}`}>{p.name}</p>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-3xl font-black text-slate-900">{p.price.toLocaleString()}</span>
                      <span className="text-sm font-semibold text-slate-400">원/월</span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-slate-400">직무지도원·현장 무제한 · VAT 별도</p>
                    <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                      {p.features.map((f, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-slate-950" />
                          <span className="text-sm font-semibold text-slate-700">{f}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => !isCurrent && subscribe(p.id)}
                      disabled={isCurrent || busy}
                      className={`mt-4 min-h-11 w-full rounded-xl text-sm font-black transition active:scale-[0.97] disabled:opacity-60 ${
                        isCurrent ? "bg-slate-100 text-slate-400" : "bg-slate-950 text-white"
                      }`}
                    >
                      {isCurrent ? "현재 플랜" : busy ? "처리 중…" : isPaid ? "이 플랜으로 변경" : "구독 시작"}
                    </button>
                  </div>
                );
              })}
            </div>
            <p className="text-xs font-semibold text-slate-400">카드 등록 후 매월 자동 결제됩니다. 문의: able-link.co.kr</p>
          </div>
        )}
      </div>
    </>
  );
}
