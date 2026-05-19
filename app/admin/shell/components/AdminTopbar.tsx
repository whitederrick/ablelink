"use client";
// app/admin/shell/components/AdminTopbar.tsx

import { useRouter } from "next/navigation";
import { useState } from "react";

type SessionInfo = {
  role: "ADMIN" | "GOV" | "AGENCY" | string;
  loginId: string;
  agencyName?: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "시스템 관리자",
  GOV: "정부 기관",
  AGENCY: "에이전시",
};

export default function AdminTopbar({
  session,
  onLoggedOut,
}: {
  session?: SessionInfo;
  onLoggedOut: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    finally {
      setLoading(false);
      onLoggedOut();
      router.replace("/admin/login");
      router.refresh();
    }
  }

  const agencyName = session?.agencyName || null;
  const roleLabel = ROLE_LABEL[session?.role ?? ""] || session?.role || "";

  return (
    <header style={s.header}>
      {/* 좌측: 기관명 + 역할 */}
      <div style={s.left}>
        {agencyName && (
          <span style={s.agencyName}>{agencyName}</span>
        )}
        {agencyName && <span style={s.sep}>·</span>}
        <span style={s.roleLabel}>{roleLabel}</span>
        {session?.loginId && (
          <>
            <span style={s.sep}>·</span>
            <span style={s.loginId}>{session.loginId}</span>
          </>
        )}
      </div>

      {/* 우측: 로그아웃 */}
      <button
        onClick={logout}
        disabled={loading}
        style={s.logoutBtn}
      >
        {loading ? "로그아웃 중..." : "로그아웃"}
      </button>
    </header>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: {
    height: 52,
    background: "#ffffff",
    borderBottom: "1px solid #f0f0f0",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 28px",
    flexShrink: 0,
  },
  left: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "#6b7280",
  },
  agencyName: {
    color: "#111827",
    fontWeight: 600,
    fontSize: 13,
  },
  sep: {
    color: "#d1d5db",
    fontSize: 12,
  },
  roleLabel: {
    color: "#6b7280",
    fontSize: 12,
  },
  loginId: {
    color: "#9ca3af",
    fontSize: 12,
  },
  logoutBtn: {
    padding: "6px 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 7,
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    color: "#6b7280",
    fontWeight: 500,
    transition: "all 0.15s",
  },
};
