"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type SessionInfo = {
  role: "ADMIN" | "GOV" | "AGENCY" | string;
  loginId: string;
  agencyName?: string | null;
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

  return (
    <header style={s.header}>
      {/* 좌측: 기관명만 */}
      <div style={s.left}>
        {session?.agencyName && (
          <span style={s.agencyName}>{session.agencyName}</span>
        )}
        {session?.loginId && (
          <span style={s.loginId}>{session.loginId}</span>
        )}
      </div>

      {/* 우측: 로그아웃 */}
      <button onClick={logout} disabled={loading} style={s.logoutBtn}>
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
    gap: 8,
  },
  agencyName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#111827",
  },
  loginId: {
    fontSize: 12,
    color: "#9ca3af",
    background: "#f9fafb",
    padding: "2px 8px",
    borderRadius: 20,
    border: "1px solid #f0f0f0",
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
  },
};
