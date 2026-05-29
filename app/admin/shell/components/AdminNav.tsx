"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem  = { href: string; label: string };
type NavGroup = { title: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    title: "개요",
    items: [
      { href: "/admin",          label: "시스템 대시보드" },
    ],
  },
  {
    title: "에이전시 관리",
    items: [
      { href: "/admin/agencies",                 label: "에이전시 목록·생성" },
      { href: "/admin/manager-signup-requests",  label: "관리자 가입 신청" },
      { href: "/admin/admins",                   label: "운영자 계정 관리" },
    ],
  },
  {
    title: "전체 데이터 현황",
    items: [
      { href: "/admin/workers",     label: "전체 직무지도원" },
      { href: "/admin/sites",       label: "전체 현장" },
    ],
  },
  {
    title: "구독·사용량",
    items: [
      { href: "/admin/billing",       label: "결제·구독 현황" },
      { href: "/admin/usage",         label: "AI 사용량" },
    ],
  },
  {
    title: "운영 도구",
    items: [
      { href: "/admin/announcements", label: "시스템 공지" },
      { href: "/admin/attendances",   label: "근태 현황·교정" },
      { href: "/admin/support",       label: "지원 요청" },
    ],
  },
  {
    title: "시스템",
    items: [
      { href: "/admin/logs",          label: "감사 로그" },
      { href: "/admin/settings",      label: "시스템 설정" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col bg-slate-950 px-3 pb-8 pt-7">
      <Link href="/admin" className="mb-6 block px-3 no-underline">
        <span className="text-[22px] font-black tracking-tight text-white">AbleLink</span>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">
          System Admin
        </p>
      </Link>

      <div className="mb-5 h-px bg-slate-800" />

      <nav className="flex flex-col gap-6">
        {groups.map(g => (
          <div key={g.title}>
            <p className="mb-1.5 px-3 text-[10px] font-black uppercase tracking-widest text-slate-600">
              {g.title}
            </p>
            <div className="space-y-0.5">
              {g.items.map(item => {
                const active = isActive(item.href);
                return (
                  <Link key={item.href} href={item.href}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm no-underline transition ${
                      active ? "bg-white/10 font-black text-white" : "font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}>
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${active ? "bg-emerald-400" : "bg-slate-700"}`} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
