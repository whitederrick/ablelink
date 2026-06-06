"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

type SessionInfo = {
  role: "ADMIN" | "GOV" | "AGENCY" | string;
  loginId: string;
  agencyName?: string | null;
  displayName?: string | null;
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
      await fetch("/api/manager/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    finally {
      onLoggedOut();
      window.location.href = "/manager/login";
    }
  }

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-7">
      {/* 좌측: 소속 기관명 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-black text-slate-900">
          {session?.agencyName || "AbleLink"}
        </span>
        <span className="flex-shrink-0 rounded-full border border-slate-100 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-400">
          관리자
        </span>
      </div>

      {/* 우측: 로그인 사용자 이름 + 로그아웃 */}
      <div className="flex flex-shrink-0 items-center gap-3">
        <span className="text-sm font-bold text-slate-600">
          {session?.displayName || session?.loginId}
        </span>
        <button
          onClick={logout}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {loading ? "로그아웃 중..." : "로그아웃"}
        </button>
      </div>
    </header>
  );
}
