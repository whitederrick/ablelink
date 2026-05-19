// app/admin/shell/AdminShellClient.tsx
// This is the layout component for the admin panel, wrapping all admin pages with the AdminShellClient.
// It ensures consistent layout and navigation across the admin interface.

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

  // ✅ 실제 라우트와 동일하게 (소문자)
  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/auth/me", { method: "GET", cache: "no-store" });
        const data = (await res.json()) as MeResponse;

        if (cancelled) return;

        if (!data || (data as any).success !== true) {
          router.replace("/admin/login");
          return;
        }

        setSession(data);
      } catch {
        router.replace("/admin/login");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;

  if (loading) {
    return <div style={{ padding: 24, fontSize: 14, color: "#444" }}>관리자 포털 로딩 중...</div>;
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#fafafa" }}>
      <AdminNav />
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <AdminTopbar
          session={(session as any)?.session}
          onLoggedOut={() => router.replace("/admin/login")}
        />
        <main style={{ padding: 16 }}>{children}</main>
      </div>
    </div>
  );
}
