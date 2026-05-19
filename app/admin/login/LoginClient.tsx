// app/admin/login/LoginClient.tsx
// This is the client component for the admin login form.

"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export default function LoginClient() {
  const sp = useSearchParams();
  const router = useRouter();

  // 예: /admin/login?next=/admin/sites
  const nextUrl = useMemo(() => sp.get("next") || "/admin/sites", [sp]);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.message || "LOGIN_FAILED");
        return;
      }
      router.replace(nextUrl);
    } catch (err: any) {
      setError(err?.message || "NETWORK_ERROR");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Admin Login</h1>

      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          placeholder="loginId"
          autoComplete="username"
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="password"
          type="password"
          autoComplete="current-password"
          style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />

        {error ? <div style={{ color: "crimson" }}>{error}</div> : null}

        <button
          type="submit"
          disabled={loading}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
