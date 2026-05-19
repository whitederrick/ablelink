// app/worker/login/page.tsx
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
      if (!data.success) {
        setError(data.message || "로그인에 실패했습니다.");
        return;
      }
      if (data.hasActiveSite) {
        router.replace("/worker/home");
      } else {
        router.replace("/worker/site/register");
      }
    } catch {
      setError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.wrap}>
      <div style={s.inner}>
        {/* 로고 */}
        <div style={s.logoBox}>
          <h1 style={s.logo}>Able Link</h1>
          <p style={s.sub}>장애인 직무지도 지원 서비스</p>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.field}>
            <input
              type="tel"
              placeholder="아이디 (휴대전화번호)"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              style={s.input}
              autoComplete="username"
              inputMode="numeric"
              required
            />
          </div>
          <div style={s.field}>
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={s.input}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p style={s.errorMsg}>{error}</p>}

          <button type="submit" style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        {/* 링크 */}
        <div style={s.links}>
          <span style={s.linkText}>계정이 없으신가요?</span>
          <Link href="/worker/register" style={s.link}>회원가입</Link>
        </div>

        {/* 플랜 안내 배너 */}
        <div style={s.banner}>
          <p style={s.bannerTitle}>🎁 AI 기능 15일 무료 체험</p>
          <p style={s.bannerDesc}>
            음성 일지 작성, PDF 자동 생성 등<br />
            PREMIUM 기능을 무료로 경험해보세요.
          </p>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: "100dvh",
    backgroundColor: "#f8f9ff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "20px",
  },
  inner: {
    width: "100%",
    maxWidth: "420px",
    backgroundColor: "#fff",
    borderRadius: "20px",
    padding: "40px 32px",
    boxShadow: "0 4px 24px rgba(88,101,242,0.10)",
  },
  logoBox: { textAlign: "center", marginBottom: "40px" },
  logo: { fontSize: "36px", fontWeight: 700, color: "#5865F2", margin: 0 },
  sub: { fontSize: "14px", color: "#888", marginTop: "6px" },
  form: { display: "flex", flexDirection: "column", gap: "14px" },
  field: { width: "100%" },
  input: {
    width: "100%",
    height: "52px",
    border: "none",
    borderBottom: "1.5px solid #ddd",
    fontSize: "16px",
    color: "#333",
    backgroundColor: "transparent",
    outline: "none",
    boxSizing: "border-box",
    padding: "0 4px",
  },
  errorMsg: {
    color: "#e53935",
    fontSize: "13px",
    margin: "0",
    padding: "8px 12px",
    backgroundColor: "#fff5f5",
    borderRadius: "8px",
    textAlign: "center",
  },
  btn: {
    width: "100%",
    height: "52px",
    backgroundColor: "#5865F2",
    color: "#fff",
    fontSize: "17px",
    fontWeight: 700,
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    marginTop: "6px",
    transition: "opacity 0.2s",
  },
  links: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: "8px",
    marginTop: "20px",
  },
  linkText: { fontSize: "14px", color: "#888" },
  link: { fontSize: "14px", color: "#5865F2", fontWeight: 600, textDecoration: "none" },
  banner: {
    marginTop: "28px",
    padding: "16px",
    backgroundColor: "#f0f2ff",
    borderRadius: "12px",
    textAlign: "center",
  },
  bannerTitle: { fontSize: "14px", fontWeight: 700, color: "#5865F2", margin: "0 0 6px" },
  bannerDesc: { fontSize: "12px", color: "#666", margin: 0, lineHeight: 1.6 },
};
