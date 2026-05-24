"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

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
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);
    try {
      await fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    finally {
      onLoggedOut();
      window.location.href = "/admin/login";
    }
  }

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-7">
      <div className="flex items-center gap-2">
        {session?.agencyName && (
          <span className="text-sm font-black text-slate-900">{session.agencyName}</span>
        )}
        {session?.loginId && (
          <span className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-400">
            {session.loginId}
          </span>
        )}
      </div>

      <button
        onClick={logout}
        disabled={loading}
        className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
      >
        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
        {loading ? "로그아웃 중..." : "로그아웃"}
      </button>
    </header>
  );
}
