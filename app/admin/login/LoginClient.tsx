"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export default function LoginClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const nextUrl = useMemo(() => sp.get("next") || "/admin", [sp]);

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
        setError(data?.message || "아이디 또는 비밀번호를 확인해주세요.");
        return;
      }
      router.replace(nextUrl);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* 로고 */}
        <div style={s.logoWrap}>
          <div style={s.logoText}>
            <span style={{ color: "#111827" }}>Able</span>
            <span style={{ color: "#ef4444" }}> Link</span>
          </div>
          <p style={s.logoSub}>에이전시 운영 플랫폼</p>
        </div>

        {/* 폼 */}
        <form onSubmit={onSubmit} style={s.form}>
          <div style={s.fieldGroup}>
            <label style={s.label}>아이디</label>
            <input
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              placeholder="아이디를 입력하세요"
              autoComplete="username"
              style={s.input}
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>비밀번호</label>
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              type="password"
              autoComplete="current-password"
              style={s.input}
            />
          </div>

          {error && (
            <div style={s.error}>{error}</div>
          )}

          <button type="submit" disabled={loading} style={s.btn}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f7f8fa",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    background: "#fff",
    borderRadius: 16,
    padding: "40px 36px",
    border: "1px solid #f0f0f0",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
  },
  logoWrap: {
    marginBottom: 32,
    textAlign: "center",
  },
  logoText: {
    fontSize: 32,
    fontWeight: 900,
    fontFamily: "'Arial Black', 'Helvetica Neue', sans-serif",
    letterSpacing: "-0.5px",
    lineHeight: 1,
    marginBottom: 6,
  },
  logoSub: {
    fontSize: 13,
    color: "#9ca3af",
    margin: 0,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#374151",
  },
  input: {
    width: "100%",
    padding: "10px 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 9,
    fontSize: 14,
    color: "#111827",
    outline: "none",
    background: "#fafafa",
    fontFamily: "inherit",
    boxSizing: "border-box",
  },
  error: {
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
    color: "#dc2626",
  },
  btn: {
    width: "100%",
    padding: "12px",
    background: "#111827",
    color: "#fff",
    border: "none",
    borderRadius: 9,
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 4,
    letterSpacing: "-0.2px",
  },
};
