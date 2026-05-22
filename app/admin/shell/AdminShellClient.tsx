"use client";
// app/admin/shell/AdminShellClient.tsx

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

  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/auth/me", { method: "GET", cache: "no-store" });
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        if (!data || (data as any).success !== true) { router.replace("/admin/login"); return; }
        setSession(data);
      } catch {
        router.replace("/admin/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoginPage]);

  if (isLoginPage) return <>{children}</>;

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f9fafb" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #3b82f6", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto 12px" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <p style={{ fontSize: 13, color: "#9ca3af", margin: 0 }}>로딩 중...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#f7f8fa" }}>
      <AdminNav />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <AdminTopbar
          session={(session as any)?.session}
          onLoggedOut={() => router.replace("/admin/login")}
        />
        <main style={{
          flex: 1,
          padding: "28px 32px",
          overflowY: "auto" as const,
        }}>
          {children}
        </main>
      </div>
    </div>
  );
}
