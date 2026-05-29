"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem  = { href: string; label: string };
type NavGroup = { title: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    title: "개요",
    items: [
      { href: "/manager", label: "대시보드" },
    ],
  },
  {
    title: "현장/인원",
    items: [
      { href: "/manager/sites",    label: "현장(Site) 관리" },
      { href: "/manager/coaches",  label: "직무지도원 관리" },
      { href: "/manager/trainees", label: "훈련생 현황" },
      { href: "/manager/managers", label: "담당자 관리" },
    ],
  },
  {
    title: "근태/일지",
    items: [
      { href: "/manager/attendances",              label: "근태 현황" },
      { href: "/manager/calendar",                 label: "근태 캘린더" },
      { href: "/manager/inbox/attendance",         label: "GPS 승인 대기" },
      { href: "/manager/attendance-edit-requests", label: "출근부 수정 요청" },
      { href: "/manager/holiday-requests",         label: "커스텀 휴무일 관리" },
      { href: "/manager/logs",                     label: "일지 내용 열람" },
    ],
  },
  {
    title: "문서/소통",
    items: [
      { href: "/manager/contracts",  label: "근로계약서" },
      { href: "/manager/documents",  label: "문서 운영" },
      { href: "/manager/docs",       label: "문서 조회" },
      { href: "/manager/review",     label: "확정 현황" },
      { href: "/manager/reports",    label: "진척도 리포트" },
      { href: "/manager/notices",    label: "공지 발송" },
    ],
  },
  {
    title: "정산",
    items: [
      { href: "/manager/payroll",   label: "급여 관리" },
      { href: "/manager/signature", label: "내 서명" },
    ],
  },
  {
    title: "고객 지원",
    items: [
      { href: "/manager/support", label: "운영자 문의" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col bg-slate-950 px-3 pb-8 pt-7">
      <Link href="/manager" className="mb-6 block px-3 no-underline">
        <span className="text-[22px] font-black tracking-tight text-white">AbleLink</span>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Agency Manager
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
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${active ? "bg-sky-400" : "bg-slate-700"}`} />
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
