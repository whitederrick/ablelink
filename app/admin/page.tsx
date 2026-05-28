"use client";

import { useEffect, useState } from "react";
import { Building2, Users, MapPin, CreditCard, TrendingUp } from "lucide-react";

interface SystemStats {
  agencyCount: number;
  coachCount: number;
  siteCount: number;
  traineeCount: number;
  activeSubscriptions: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/system/stats")
      .then(r => r.json())
      .then(d => { if (d.success) setStats(d.stats); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-black text-slate-900">시스템 대시보드</h1>
        <p className="mt-0.5 text-sm text-slate-500">AbleLink 전체 운영 현황</p>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {[
            { icon: Building2,  label: "에이전시",   value: stats?.agencyCount ?? 0,        color: "text-violet-600 bg-violet-50" },
            { icon: Users,      label: "직무지도원", value: stats?.coachCount ?? 0,          color: "text-sky-600 bg-sky-50" },
            { icon: MapPin,     label: "현장(Site)", value: stats?.siteCount ?? 0,           color: "text-emerald-600 bg-emerald-50" },
            { icon: Users,      label: "훈련생",     value: stats?.traineeCount ?? 0,        color: "text-amber-600 bg-amber-50" },
            { icon: CreditCard, label: "유료 구독",  value: stats?.activeSubscriptions ?? 0, color: "text-rose-600 bg-rose-50" },
          ].map(card => (
            <div key={card.label} className="rounded-2xl border border-slate-100 bg-white p-5">
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${card.color}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <p className="text-2xl font-black text-slate-900">{card.value.toLocaleString()}</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-500">{card.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-slate-100 bg-white p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="h-5 w-5 text-slate-400" />
          <h2 className="text-base font-black text-slate-900">시스템 안내</h2>
        </div>
        <div className="space-y-2 text-sm font-semibold text-slate-500">
          <p>· 에이전시 관리 → 에이전시 계정 생성/관리, 구독 플랜 설정</p>
          <p>· 구독 관리 → 결제 현황 및 플랜 변경</p>
          <p>· 전체 현황 → 모든 에이전시의 현장/직무지도원/근태 조회</p>
          <p>· 에이전시 관리자 계정은 <a href="/manager/login" className="text-sky-600 underline">/manager/login</a>에서 로그인합니다.</p>
        </div>
      </div>
    </div>
  );
}
