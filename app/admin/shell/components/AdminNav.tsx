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
      { href: "/admin", label: "대시보드", icon: "📊" },
    ],
  },
  {
    title: "기초 정보",
    items: [
      { href: "/admin/sites", label: "Site 관리", icon: "🏢" },
      { href: "/admin/managers", label: "담당자(기관) 관리", icon: "👤" },
      { href: "/admin/coaches", label: "직무지도원 관리", icon: "🧑‍💼" },
      { href: "/admin/trainees", label: "훈련생 현황", icon: "👥" },
    ],
  },
  {
    title: "배정/운영",
    items: [
      { href: "/admin/attendances", label: "근태 현황", icon: "📅" },
      { href: "/admin/inbox/attendance", label: "GPS 승인 대기", icon: "📍" },
      { href: "/admin/documents", label: "문서 운영", icon: "📄" },
    ],
  },
  {
    title: "구독/정산",
    items: [
      { href: "/admin/subscription", label: "구독 관리", icon: "💳" },
    ],
  },
];

export default function AdminNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <aside style={s.aside}>
      <div style={s.logo}>ABLELINK ADMIN</div>
      <div style={s.version}>에이전시 운영형</div>

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
                  <span style={s.navIcon}>{item.icon}</span>
                  <span>{item.label}</span>
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
    width: 220,
    minHeight: "100vh",
    background: "#111827",
    color: "#fff",
    padding: "20px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 0,
    flexShrink: 0,
  },
  logo: {
    fontWeight: 800,
    fontSize: 13,
    letterSpacing: 0.5,
    marginBottom: 4,
    color: "#fff",
  },
  version: {
    fontSize: 11,
    color: "rgba(255,255,255,0.45)",
    marginBottom: 24,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  groupTitle: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
    letterSpacing: 0.5,
    marginBottom: 6,
    paddingLeft: 10,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    textDecoration: "none",
    color: "rgba(255,255,255,0.75)",
    padding: "9px 10px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    transition: "background 0.15s",
  },
  navItemActive: {
    background: "rgba(255,255,255,0.12)",
    color: "#fff",
    fontWeight: 700,
  },
  navIcon: {
    fontSize: 15,
    flexShrink: 0,
  },
};
