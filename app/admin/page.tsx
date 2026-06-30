"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Users, MapPin, CreditCard, UserCog, UserPlus, Bell, ClipboardCheck, Sparkles, Settings, ArrowRight } from "lucide-react";
import PageHeader from "./_components/PageHeader";

interface SystemStats {
  agencyCount: number;
  workerCount: number;
  siteCount: number;
  traineeCount: number;
  activeSubscriptions: number;
}

// 통계 카드 → 해당 목록 화면으로 이동
const STAT_CARDS = [
  { key: "agencyCount",          icon: Building2,  label: "위탁기관",   href: "/admin/agencies", color: "text-violet-600 bg-violet-50" },
  { key: "workerCount",          icon: Users,      label: "직무지도원", href: "/admin/workers",  color: "text-sky-600 bg-sky-50" },
  { key: "siteCount",            icon: MapPin,     label: "현장(사업체)", href: "/admin/sites",    color: "text-emerald-600 bg-emerald-50" },
  { key: "traineeCount",         icon: Users,      label: "훈련생",     href: "/admin/trainees", color: "text-amber-600 bg-amber-50" },
  { key: "activeSubscriptions",  icon: CreditCard, label: "유료 구독",  href: "/admin/billing",  color: "text-rose-600 bg-rose-50" },
] as const;

// 주요 메뉴 바로가기
const QUICK_LINKS = [
  { href: "/admin/agencies",                label: "위탁기관 관리",      desc: "위탁기관 생성·플랜·한도",        icon: Building2 },
  { href: "/admin/manager-signup-requests", label: "위탁기관 관리자 관리", desc: "가입 신청 검토·승인",            icon: UserPlus },
  { href: "/admin/admins",                  label: "시스템 운영자 관리",  desc: "운영자·관리자 계정",             icon: UserCog },
  { href: "/admin/talent",                  label: "인재풀 관리",        desc: "구직 직무지도원·공고·자격검증",   icon: Sparkles },
  { href: "/admin/billing",                 label: "구독/사용량 현황",    desc: "결제·구독·AI 사용량",            icon: CreditCard },
  { href: "/admin/announcements",           label: "시스템 공지",        desc: "관리자·전체 사용자 공지 발송",    icon: Bell },
  { href: "/admin/attendances",             label: "근태 현황·교정",     desc: "전체 위탁기관 근태 조회·교정",    icon: ClipboardCheck },
  { href: "/admin/settings",                label: "시스템 설정",        desc: "운영 설정값·간이세액표·카테고리",  icon: Settings },
];

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
      <PageHeader title="시스템 대시보드" sub="Able-Link 전체 운영 현황 · 카드를 누르면 해당 화면으로 이동합니다" />

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {STAT_CARDS.map(card => (
            <Link key={card.label} href={card.href}
              className="group rounded-2xl border border-slate-100 bg-white p-5 no-underline transition hover:border-slate-300 hover:shadow-sm">
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${card.color}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <p className="text-2xl font-black text-slate-900">{((stats?.[card.key] ?? 0) as number).toLocaleString()}</p>
              <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-slate-500">
                {card.label}
                <ArrowRight className="h-3.5 w-3.5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* 주요 메뉴 바로가기 */}
      <div className="mt-8">
        <h2 className="mb-3 text-base font-black text-slate-900">바로가기</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(q => (
            <Link key={q.href} href={q.href}
              className="group flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-4 no-underline transition hover:border-slate-300 hover:shadow-sm">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                <q.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-black text-slate-900">{q.label}</p>
                <p className="mt-0.5 text-[13px] font-medium text-slate-500">{q.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
