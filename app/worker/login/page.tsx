"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function WorkerLoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/worker/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.replace(/-/g, ""), password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "로그인에 실패했습니다."); return; }
      router.replace(data.hasActiveSite ? "/worker/home" : "/worker/site/register");
    } catch {
      setError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally { setLoading(false); }
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
          <p style={s.logoSub}>장애인 직무지도 지원 서비스</p>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.fieldGroup}>
            <label style={s.label}>아이디 (휴대전화번호)</label>
            <input
              type="tel"
              placeholder="01012345678"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              style={s.input}
              autoComplete="username"
              inputMode="numeric"
              required
            />
          </div>
          <div style={s.fieldGroup}>
            <label style={s.label}>비밀번호</label>
            <input
              type="password"
              placeholder="비밀번호를 입력하세요"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={s.input}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button type="submit" disabled={loading}
            style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {/* 회원가입 링크 */}
        <div style={s.links}>
          <span style={s.linkText}>계정이 없으신가요?</span>
          <Link href="/worker/register" style={s.link}>회원가입</Link>
        </div>

        {/* AI 기능 배너 */}
        <div style={s.banner}>
          <p style={s.bannerTitle}>🎁 AI 기능 15일 무료 체험</p>
          <p style={s.bannerDesc}>음성 일지 작성, PDF 자동 생성 등<br />PREMIUM 기능을 무료로 경험해보세요.</p>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    background: "#f7f8fa",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    background: "#fff",
    borderRadius: 20,
    padding: "40px 28px",
    boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
    border: "1px solid #f0f0f0",
  },
  logoWrap: { textAlign: "center", marginBottom: 36 },
  logoText: {
    fontSize: 34,
    fontWeight: 900,
    fontFamily: "'Arial Black', sans-serif",
    letterSpacing: "-0.5px",
    lineHeight: 1,
    marginBottom: 6,
  },
  logoSub: { fontSize: 13, color: "#9ca3af", margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: 16 },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: "#374151" },
  input: {
    width: "100%",
    padding: "12px 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    fontSize: 15,
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
    textAlign: "center",
  },
  btn: {
    width: "100%",
    padding: "14px",
    background: "#111827",
    color: "#fff",
    border: "none",
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 4,
  },
  links: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 20,
  },
  linkText: { fontSize: 14, color: "#9ca3af" },
  link: { fontSize: 14, color: "#2563eb", fontWeight: 600, textDecoration: "none" },
  banner: {
    marginTop: 24,
    padding: "14px 16px",
    background: "#eff6ff",
    borderRadius: 12,
    textAlign: "center",
    border: "1px solid #bfdbfe",
  },
  bannerTitle: { fontSize: 13, fontWeight: 700, color: "#2563eb", margin: "0 0 4px" },
  bannerDesc: { fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.6 },
};
