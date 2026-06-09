"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Lock } from "lucide-react";

// 필요 플랜(생략 = FREE). planGuard.ts 기능 경계 기준(2026-06-06 재배치):
//  - 문서 인박스(DOC_INBOX) = STARTER
//  - 진척도 리포트(TRAINEE_REPORT) = STANDARD
//  - 근로계약서(CONTRACT_ONLINE)·급여(PAYROLL) = PRO
//  - (PRO 전용 매칭/인재풀은 아직 네비 미연결)
type PlanTier = "STARTER" | "STANDARD" | "PRO";
type NavItem  = { href: string; label: string; plan?: PlanTier };
type NavGroup = { title: string; items: NavItem[] };

// 등급 메타: 정렬 순위 + 배지 라벨/색(다크 네비용)
const TIER_META: Record<PlanTier, { rank: number; label: string; cls: string }> = {
  STARTER:  { rank: 1, label: "STARTER",  cls: "bg-sky-500/15 text-sky-300" },
  STANDARD: { rank: 2, label: "STANDARD", cls: "bg-violet-500/15 text-violet-300" },
  PRO:      { rank: 3, label: "PRO",      cls: "bg-amber-500/15 text-amber-300" },
};
// 현재 플랜 → 접근 가능 등급(TRIAL은 전체 허용)
const PLAN_RANK: Record<string, number> = { FREE: 0, TRIAL: 3, STARTER: 1, STANDARD: 2, PRO: 3 };

const itemRank = (it: NavItem) => (it.plan ? TIER_META[it.plan].rank : 0);

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
      { href: "/manager/workers",  label: "직무지도원 관리" },
      { href: "/manager/trainees", label: "훈련생 현황" },
    ],
  },
  {
    title: "근태/일지",
    items: [
      { href: "/manager/attendances",              label: "근태 현황" },
      { href: "/manager/calendar",                 label: "근태 캘린더" },
      { href: "/manager/inbox/attendance",         label: "근태 이슈 확인" },
      { href: "/manager/attendance-edit-requests", label: "출근부 수정 요청" },
      { href: "/manager/holiday-requests",         label: "커스텀 휴무일 관리" },
      { href: "/manager/logs",                     label: "훈련 일지 열람" },
    ],
  },
  {
    // 비즈니스 흐름순(아래 수동 순서를 그대로 노출 — 플랜순 자동정렬 미적용).
    // 리포트(현황 대시보드) → 확정 → 발급·출력 → 제출관리 → 계약 → 소통(공지·알림).
    title: "문서/소통",
    items: [
      { href: "/manager/reports",       label: "훈련생 진척도 리포트", plan: "STANDARD" }, // 그룹 대시보드
      { href: "/manager/review",        label: "출근부·일지 확정" },
      { href: "/manager/docs",          label: "문서 발급·출력",      plan: "STARTER" },
      { href: "/manager/documents",     label: "문서 발송·제출 관리", plan: "STARTER" },
      { href: "/manager/contracts",     label: "근로계약서", plan: "PRO" },
      { href: "/manager/announcements", label: "공지 게시판" },
      { href: "/manager/notices",       label: "알림 발송(개별)" },
    ],
  },
  {
    title: "직무지도 매칭",
    items: [
      { href: "/manager/recruit", label: "직무지도 공고",  plan: "PRO" },
      { href: "/manager/talent",  label: "인재풀 검색",    plan: "PRO" },
    ],
  },
  {
    title: "정산",
    items: [
      { href: "/manager/signature", label: "내 서명" },
      { href: "/manager/payroll",   label: "급여 관리", plan: "PRO" },
    ],
  },
  {
    title: "구독/지원",
    items: [
      { href: "/manager/subscription", label: "구독 관리" },
      { href: "/manager/support",      label: "운영자 문의" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  // 현재 플랜 등급. 로딩 전엔 잠금 깜빡임 방지를 위해 전체 허용(99)으로 둔다.
  const [currentRank, setCurrentRank] = useState(99);

  useEffect(() => {
    fetch("/api/admin/subscription", { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const plan = d?.success ? d.data?.[0]?.planType : undefined;
        if (plan) setCurrentRank(PLAN_RANK[plan] ?? 0);
      })
      .catch(() => {});
  }, []);

  const isActive = (href: string) =>
    href === "/manager" ? pathname === "/manager" : pathname.startsWith(href);

  // 아코디언: 한 번에 한 카테고리만 펼침(나머지 자동 접힘) → 세로 스크롤 최소화.
  const activeGroupTitle = groups.find(g => g.items.some(it => isActive(it.href)))?.title ?? groups[0].title;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupTitle);
  useEffect(() => { setOpenGroup(activeGroupTitle); }, [activeGroupTitle]);

  return (
    <aside className="flex w-[220px] flex-shrink-0 flex-col overflow-y-auto bg-slate-950 px-3 pb-8 pt-7">
      <Link href="/manager" className="mb-6 block px-3 no-underline">
        <span className="text-[22px] font-black tracking-tight text-white">AbleLink</span>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Agency Manager
        </p>
      </Link>

      <div className="mb-5 h-px bg-slate-800" />

      <nav className="flex flex-col gap-1.5">
        {groups.map(g => {
          // 메뉴는 정의된 수동 순서를 그대로 노출(비즈니스 흐름 우선). 잠금 배지는 유지.
          const items = g.items;
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
                {items.map(item => {
                  const active = isActive(item.href);
                  const tier = item.plan ? TIER_META[item.plan] : null;
                  const locked = tier ? currentRank < tier.rank : false;
                  return (
                    <Link key={item.href} href={item.href}
                      title={locked ? `${tier!.label} 플랜 이상에서 사용 가능` : undefined}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm no-underline transition ${
                        active
                          ? "bg-white/10 font-black text-white"
                          : locked
                            ? "font-semibold text-slate-500 hover:bg-white/5"
                            : "font-semibold text-slate-400 hover:bg-white/5 hover:text-slate-200"
                      }`}>
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${active ? "bg-sky-400" : "bg-slate-700"}`} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {tier && locked && (
                        <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black tracking-wide ${tier.cls}`}>
                          <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                          {tier.label}
                        </span>
                      )}
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
