"use client";
import { useEffect, useState } from "react";
import { T } from "../_styles";

interface AgencySub {
  id: string; name: string; planType: string;
  trialStartedAt: string | null; trialEndsAt: string | null;
  subscribedAt: string | null; nextBillingAt: string | null;
  maxCoaches: number; maxSites: number;
  currentCoaches: number; currentSites: number;
}

const PLAN_CLS: Record<string, { label: string; cls: string }> = {
  FREE:     { label: "무료",    cls: "bg-slate-100 text-slate-500" },
  TRIAL:    { label: "체험중",  cls: "bg-amber-50 text-amber-600" },
  STARTER:  { label: "스타터",  cls: "bg-sky-50 text-sky-600" },
  STANDARD: { label: "스탠다드", cls: "bg-violet-50 text-violet-600" },
  PRO:      { label: "프로",    cls: "bg-emerald-50 text-emerald-600" },
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
  const paidCount  = agencies.filter(a => ["STARTER", "STANDARD", "PRO"].includes(a.planType)).length;

  return (
    <div className="space-y-5">
      <h1 className={T.pageTitle}>구독 관리</h1>

      <div className={T.summaryGrid}>
        {[
          { label: "전체 에이전시", value: agencies.length, cls: "text-slate-900" },
          { label: "무료",          value: freeCount,        cls: "text-slate-400" },
          { label: "체험중",        value: trialCount,       cls: "text-amber-600" },
          { label: "유료 구독",     value: paidCount,        cls: "text-emerald-600" },
        ].map((item, i) => (
          <div key={i} className={T.summaryCard}>
            <p className={`${T.summaryNum} ${item.cls}`}>{item.value}</p>
            <p className={T.summaryLabel}>{item.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <p className={T.empty}>로딩 중...</p>
      ) : agencies.length === 0 ? (
        <p className={T.empty}>등록된 에이전시가 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {agencies.map(a => {
            const plan = PLAN_CLS[a.planType] || PLAN_CLS.FREE;
            const isTrialExpired = a.planType === "TRIAL" && a.trialEndsAt && new Date(a.trialEndsAt) < new Date();
            return (
              <div key={a.id} className={T.card}>
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-base font-black text-slate-900">{a.name}</span>
                    <span className={`${T.badge} ${plan.cls}`}>{plan.label}</span>
                    {isTrialExpired && <span className={`${T.badge} bg-rose-50 text-rose-600`}>만료</span>}
                  </div>
                  <select value={a.planType} onChange={e => handleChangePlan(a.id, e.target.value)}
                    className={T.select}>
                    {Object.entries(PLAN_CLS).map(([val, { label }]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-6">
                  <div>
                    <div className="text-xs font-semibold text-slate-400">직무지도원</div>
                    <div className="text-sm font-semibold text-slate-700">
                      {a.currentCoaches}명{a.maxCoaches > 0 ? ` / ${a.maxCoaches}명` : " (무제한)"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-400">Site</div>
                    <div className="text-sm font-semibold text-slate-700">
                      {a.currentSites}개{a.maxSites > 0 ? ` / ${a.maxSites}개` : " (무제한)"}
                    </div>
                  </div>
                  {a.trialEndsAt && (
                    <div>
                      <div className="text-xs font-semibold text-slate-400">체험 만료</div>
                      <div className={`text-sm font-semibold ${isTrialExpired ? "text-rose-600" : "text-amber-600"}`}>
                        {a.trialEndsAt.slice(0, 10)}
                      </div>
                    </div>
                  )}
                  {a.nextBillingAt && (
                    <div>
                      <div className="text-xs font-semibold text-slate-400">다음 결제</div>
                      <div className="text-sm font-semibold text-slate-700">{a.nextBillingAt.slice(0, 10)}</div>
                    </div>
                  )}
                  {a.subscribedAt && (
                    <div>
                      <div className="text-xs font-semibold text-slate-400">구독 시작</div>
                      <div className="text-sm font-semibold text-slate-700">{a.subscribedAt.slice(0, 10)}</div>
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
