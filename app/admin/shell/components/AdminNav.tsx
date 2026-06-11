"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

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
    title: "에이전시 운영 관리",
    items: [
      { href: "/admin/agencies",                 label: "에이전시 관리" },
      { href: "/admin/manager-signup-requests",  label: "에이전시 관리자 관리" },
      { href: "/admin/admins",                   label: "시스템 운영자 관리" },
    ],
  },
  {
    title: "에이전시 데이터 관리",
    items: [
      { href: "/admin/workers",     label: "직무지도원 현황 관리" },
      { href: "/admin/sites",       label: "현장(Site) 현황 관리" },
      { href: "/admin/attendances", label: "근태 현황 관리" },
      { href: "/admin/survey-requests", label: "직무지도원 평가 요청 관리" },
      { href: "/admin/surveys",     label: "직무지도원 만족도 평가 결과" },
    ],
  },
  {
    title: "구독/사용량 현황",
    items: [
      { href: "/admin/billing",       label: "결제·구독 현황" },
      { href: "/admin/usage",         label: "AI 사용량" },
    ],
  },
  {
    title: "인재풀 관리",
    items: [
      { href: "/admin/talent",      label: "인재풀 검색" },
      { href: "/admin/recruit",     label: "직무지도 공고" },
      { href: "/admin/professions", label: "자격 검증" },
      { href: "/admin/eval-forms",  label: "직무지도원 평가 관리" },
    ],
  },
  {
    title: "소통·지원",
    items: [
      { href: "/admin/announcements", label: "시스템 공지" },
      { href: "/admin/support",       label: "지원 요청" },
    ],
  },
  {
    title: "시스템 설정",
    items: [
      { href: "/admin/settings",                    label: "운영 설정값" },
      { href: "/admin/settings/income-tax",         label: "근로소득 간이세액표" },
      { href: "/admin/settings/categories",         label: "공지 카테고리 관리" },
      { href: "/admin/backup",                      label: "데이터 백업" },
      { href: "/admin/logs",                        label: "감사 로그" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) => {
    // /admin·/admin/settings는 하위 라우트가 있어 정확히 일치할 때만 활성
    if (href === "/admin" || href === "/admin/settings") return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  };

  // 아코디언: 한 번에 한 카테고리만 펼침(나머지 자동 접힘) → 세로 스크롤 최소화. (에이전시 매니저와 동일)
  const activeGroupTitle = groups.find(g => g.items.some(it => isActive(it.href)))?.title ?? groups[0].title;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupTitle);
  useEffect(() => { setOpenGroup(activeGroupTitle); }, [activeGroupTitle]);

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col overflow-y-auto bg-slate-950 px-3 pb-8 pt-7">
      <Link href="/admin" className="mb-6 block px-3 no-underline">
        <span className="text-[22px] font-black tracking-tight text-white">AbleLink</span>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-500">
          System Admin
        </p>
      </Link>

      <div className="mb-5 h-px bg-slate-800" />

      <nav className="flex flex-col gap-1.5">
        {groups.map(g => {
          const open = openGroup === g.title;
          return (
            <div key={g.title}>
              <button
                onClick={() => setOpenGroup(prev => (prev === g.title ? null : g.title))}
                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[13px] font-black tracking-tight text-slate-300 transition hover:bg-white/5 hover:text-white"
              >
                <span>{g.title}</span>
                <span className="text-base leading-none text-slate-500">{open ? "–" : "+"}</span>
              </button>
              <div className={`mt-0.5 space-y-0.5 ${open ? "" : "hidden"}`}>
                {g.items.map(item => {
                  const active = isActive(item.href);
                  return (
                    <Link key={item.href} href={item.href}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm no-underline transition ${
                        active ? "bg-white/10 font-black text-white" : "font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}>
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${active ? "bg-emerald-400" : "bg-slate-700"}`} />
                      <span className="flex-1 truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
