"use client";
// app/admin/shell/components/AdminNav.tsx

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; icon: string; };
type NavGroup = { title: string; items: NavItem[]; };

const groups: NavGroup[] = [
  {
    title: "개요",
    items: [
      { href: "/admin", label: "대시보드", icon: "◈" },
    ],
  },
  {
    title: "기초 정보",
    items: [
      { href: "/admin/sites", label: "Site 관리", icon: "◉" },
      { href: "/admin/managers", label: "담당자(기관) 관리", icon: "◎" },
      { href: "/admin/coaches", label: "직무지도원 관리", icon: "◐" },
      { href: "/admin/trainees", label: "훈련생 현황", icon: "◑" },
    ],
  },
  {
    title: "배정/운영",
    items: [
      { href: "/admin/attendances", label: "근태 현황", icon: "▣" },
      { href: "/admin/inbox/attendance", label: "GPS 승인 대기", icon: "▦" },
      { href: "/admin/documents", label: "문서 운영", icon: "▤" },
    ],
  },
  {
    title: "구독/정산",
    items: [
      { href: "/admin/subscription", label: "구독 관리", icon: "▧" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <aside style={s.aside}>
      {/* 로고 */}
      <div style={s.logoWrap}>
        <div style={s.logoText}>Able Link</div>
        <div style={s.logoSub}>에이전시 운영</div>
      </div>

      <div style={s.divider} />

      {/* 네비 */}
      <nav style={s.nav}>
        {groups.map(g => (
          <div key={g.title} style={s.group}>
            <div style={s.groupTitle}>{g.title}</div>
            {g.items.map(item => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  style={{
                    ...s.navItem,
                    ...(active ? s.navItemActive : {}),
                  }}
                >
                  <span style={{ ...s.navDot, ...(active ? s.navDotActive : {}) }} />
                  <span style={s.navLabel}>{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  aside: {
    width: 200,
    minHeight: "100vh",
    background: "#16181d",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    padding: "24px 0 32px",
  },
  logoWrap: {
    padding: "0 20px 0",
    marginBottom: 20,
  },
  logoText: {
    fontWeight: 800,
    fontSize: 17,
    color: "#ffffff",
    letterSpacing: "-0.5px",
    fontFamily: "Georgia, serif",
  },
  logoSub: {
    fontSize: 10,
    color: "rgba(255,255,255,0.35)",
    marginTop: 2,
    letterSpacing: "0.3px",
  },
  divider: {
    height: 1,
    background: "rgba(255,255,255,0.07)",
    margin: "0 20px 20px",
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
    padding: "0 12px",
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  groupTitle: {
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    letterSpacing: "0.8px",
    textTransform: "uppercase" as const,
    marginBottom: 4,
    paddingLeft: 10,
    fontWeight: 600,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    textDecoration: "none",
    color: "rgba(255,255,255,0.55)",
    padding: "8px 10px",
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 400,
    transition: "all 0.15s",
    letterSpacing: "-0.1px",
  },
  navItemActive: {
    background: "rgba(255,255,255,0.1)",
    color: "#ffffff",
    fontWeight: 600,
  },
  navDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.2)",
    flexShrink: 0,
  },
  navDotActive: {
    background: "#60a5fa",
  },
  navLabel: {
    lineHeight: 1,
  },
};
