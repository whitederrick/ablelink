"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import AdminNav from "./components/AdminNav";
import AdminTopbar from "./components/AdminTopbar";

type MeResponse =
  | {
      success: true;
      session: {
        role: "ADMIN" | "GOV" | "AGENCY";
        loginId: string;
        agencyName?: string | null;
      };
    }
  | { success: false; message?: string };

export default function AdminShellClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<MeResponse | null>(null);

  const isPublicPage =
    pathname === "/manager/login" ||
    pathname.startsWith("/manager/signup") ||
    pathname.startsWith("/manager/invite");

  useEffect(() => {
    if (isPublicPage) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/manager/auth/me", { method: "GET", cache: "no-store" });
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        if (!data || (data as any).success !== true) { router.replace("/manager/login"); return; }
        setSession(data);
      } catch {
        router.replace("/manager/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicPage]);

  if (isPublicPage) return <>{children}</>;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-sky-500" />
          <p className="mt-3 text-sm font-semibold text-slate-400">로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          session={(session as any)?.session}
          onLoggedOut={() => router.replace("/manager/login")}
        />
        <main className="flex-1 overflow-y-auto p-7">
          {children}
        </main>
      </div>
    </div>
  );
}
