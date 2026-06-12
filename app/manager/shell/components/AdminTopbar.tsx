"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Bell, X } from "lucide-react";

type SessionInfo = {
  role: "ADMIN" | "GOV" | "AGENCY" | string;
  loginId: string;
  agencyName?: string | null;
  displayName?: string | null;
};

type MgrNotice = {
  id: string;
  ticketId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
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

  const [notices, setNotices] = useState<MgrNotice[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const loadNotices = useCallback(() => {
    fetch("/api/manager/notices", { cache: "no-store" })
      .then(r => r.json())
      .then(d => { if (d.success) { setNotices(d.notices); setUnread(d.unreadCount ?? 0); } })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadNotices();
    const t = setInterval(loadNotices, 60000); // 1분마다 갱신
    return () => clearInterval(t);
  }, [loadNotices]);

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

  function openNotice(n: MgrNotice) {
    setOpen(false);
    if (!n.readAt) {
      setNotices(prev => prev.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x));
      setUnread(c => Math.max(0, c - 1));
      fetch("/api/manager/notices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeId: n.id }),
      }).catch(() => {});
    }
    // 지원요청 회신은 문의로, 그 외(문서 제출 등)는 제출 문서 확인 화면으로
    router.push(n.ticketId ? "/manager/support" : "/manager/documents");
  }

  async function markAll() {
    setNotices(prev => prev.map(x => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await fetch("/api/manager/notices", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }

  return (
    <header className="flex h-[52px] flex-shrink-0 items-center justify-between border-b border-slate-100 bg-white px-7">
      {/* 좌측: 소속 기관명 */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-black text-slate-900">
          {session?.agencyName || "Able-Link"}
        </span>
        <span className="flex-shrink-0 rounded-full border border-slate-100 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-400">
          관리자
        </span>
      </div>

      {/* 우측: 알림 + 사용자 + 로그아웃 */}
      <div className="flex flex-shrink-0 items-center gap-3">
        {/* 알림 벨 */}
        <div className="relative">
          <button
            onClick={() => setOpen(v => !v)}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
            aria-label="알림"
          >
            <Bell className="h-4.5 w-4.5" aria-hidden="true" />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-black text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-950/10">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-black text-slate-900">알림</p>
                <div className="flex items-center gap-3">
                  {unread > 0 && (
                    <button onClick={markAll} className="text-[11px] font-black text-sky-600">모두 읽음</button>
                  )}
                  <button onClick={() => setOpen(false)} aria-label="닫기"><X className="h-4 w-4 text-slate-400" /></button>
                </div>
              </div>
              {notices.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm font-semibold text-slate-400">알림이 없습니다.</div>
              ) : (
                <div className="max-h-96 divide-y divide-slate-50 overflow-y-auto">
                  {notices.map(n => (
                    <button
                      key={n.id}
                      onClick={() => openNotice(n)}
                      className={`block w-full px-4 py-3 text-left transition hover:bg-slate-50 ${n.readAt ? "" : "bg-rose-50/60"}`}
                    >
                      <p className="text-xs font-black text-slate-800">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs font-semibold text-slate-500">{n.body}</p>
                      <p className="mt-1 text-[10px] font-semibold text-slate-300">{new Date(n.createdAt).toLocaleString("ko-KR")}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

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
