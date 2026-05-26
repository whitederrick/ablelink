"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem  = { href: string; label: string };
type NavGroup = { title: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    title: "개요",
    items: [
      { href: "/admin", label: "대시보드" },
    ],
  },
  {
    title: "기초 정보",
    items: [
      { href: "/admin/sites",    label: "Site 관리" },
      { href: "/admin/managers", label: "담당자(기관) 관리" },
      { href: "/admin/coaches",  label: "직무지도원 관리" },
      { href: "/admin/trainees", label: "훈련생 현황" },
    ],
  },
  {
    title: "배정/운영",
    items: [
      { href: "/admin/attendances",      label: "근태 현황" },
      { href: "/admin/inbox/attendance", label: "GPS 승인 대기" },
      { href: "/admin/contracts",        label: "근로계약서" },
      { href: "/admin/documents",        label: "문서 운영" },
      { href: "/admin/docs",             label: "문서 조회" },
      { href: "/admin/reports",          label: "진척도 리포트" },
    ],
  },
  {
    title: "구독/정산",
    items: [
      { href: "/admin/payroll",      label: "급여 관리" },
      { href: "/admin/signature",    label: "내 서명" },
      { href: "/admin/subscription", label: "구독 관리" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col bg-slate-950 px-3 pb-8 pt-7">
      {/* 로고 */}
      <Link href="/admin" className="mb-6 block px-3 no-underline">
        <span className="text-[22px] font-black tracking-tight text-white">AbleLink</span>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Agency Platform
        </p>
      </Link>

      <div className="mb-5 h-px bg-slate-800" />

      {/* 네비 그룹 */}
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
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm no-underline transition ${
                      active
                        ? "bg-white/10 font-black text-white"
                        : "font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        active ? "bg-sky-400" : "bg-slate-700"
                      }`}
                    />
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
