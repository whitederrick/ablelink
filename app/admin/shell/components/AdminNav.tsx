"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string; };
type NavGroup = { title: string; items: NavItem[]; };

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
      { href: "/admin/attendances",       label: "근태 현황" },
      { href: "/admin/inbox/attendance",  label: "GPS 승인 대기" },
      { href: "/admin/contracts",         label: "근로계약서" },
      { href: "/admin/documents",         label: "문서 운영" },
      { href: "/admin/docs",              label: "문서 조회" },
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
    <aside style={s.aside}>
      {/* 로고 */}
      <Link href="/admin" style={{ textDecoration: "none" }}>
        <div style={s.logoWrap}>
          <div style={s.logoText}>
            <span style={s.logoAble}>Able</span><span style={s.logoLink}> Link</span>
          </div>
          <div style={s.logoSub}>에이전시 운영 플랫폼</div>
        </div>
      </Link>

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
                  style={{ ...s.navItem, ...(active ? s.navItemActive : {}) }}
                >
                  <span style={{ ...s.navBar, ...(active ? s.navBarActive : {}) }} />
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
    width: 220,
    minHeight: "100vh",
    background: "#111318",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    padding: "28px 0 32px",
  },
  logoWrap: {
    padding: "0 22px",
    marginBottom: 24,
  },
  logoText: {
    fontSize: 22,
    fontWeight: 900,
    fontFamily: "'Arial Black', 'Helvetica Neue', sans-serif",
    letterSpacing: "-0.5px",
    lineHeight: 1.1,
  },
  logoAble: {
    color: "#ffffff",
  },
  logoLink: {
    color: "#ef4444",
  },
  logoSub: {
    fontSize: 10,
    color: "rgba(255,255,255,0.3)",
    marginTop: 4,
    letterSpacing: "0.5px",
  },
  divider: {
    height: 1,
    background: "rgba(255,255,255,0.06)",
    margin: "0 22px 22px",
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
    gap: 2,
  },
  groupTitle: {
    fontSize: 10,
    color: "rgba(255,255,255,0.28)",
    letterSpacing: "1px",
    textTransform: "uppercase" as const,
    marginBottom: 6,
    paddingLeft: 12,
    fontWeight: 700,
  },
  navItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    textDecoration: "none",
    color: "rgba(255,255,255,0.5)",
    padding: "9px 12px",
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 400,
    transition: "all 0.15s",
    letterSpacing: "-0.1px",
  },
  navItemActive: {
    background: "rgba(255,255,255,0.08)",
    color: "#ffffff",
    fontWeight: 600,
  },
  navBar: {
    width: 3,
    height: 14,
    borderRadius: 2,
    background: "rgba(255,255,255,0.12)",
    flexShrink: 0,
  },
  navBarActive: {
    background: "#ef4444",
  },
  navLabel: {
    lineHeight: 1,
  },
};
