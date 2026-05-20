"use client";
// app/worker/register/page.tsx
// 직무지도원 회원가입 — 로그인과 동일한 스타일

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function WorkerRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    loginId: "",
    password: "",
    passwordConfirm: "",
    userName: "",
    phoneNumber: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function set(key: string, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (form.password !== form.passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (form.password.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/worker/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loginId: form.loginId.replace(/-/g, ""),
          password: form.password,
          userName: form.userName,
          phoneNumber: form.phoneNumber.replace(/-/g, "") || form.loginId.replace(/-/g, ""),
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "회원가입에 실패했습니다.");
        return;
      }
      alert("회원가입이 완료되었습니다. 로그인해주세요.");
      router.replace("/worker/login");
    } catch {
      setError("서버와 연결할 수 없습니다.");
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
          <p style={s.logoSub}>회원가입</p>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.fieldGroup}>
            <label style={s.label}>이름</label>
            <input
              style={s.input}
              placeholder="홍길동"
              value={form.userName}
              onChange={e => set("userName", e.target.value)}
              required
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>아이디 (휴대전화번호)</label>
            <input
              style={s.input}
              type="tel"
              placeholder="01012345678"
              value={form.loginId}
              onChange={e => set("loginId", e.target.value)}
              inputMode="numeric"
              required
            />
            <p style={s.hint}>휴대전화번호가 아이디가 됩니다.</p>
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>비밀번호</label>
            <input
              style={s.input}
              type="password"
              placeholder="8자 이상"
              value={form.password}
              onChange={e => set("password", e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>비밀번호 확인</label>
            <input
              style={s.input}
              type="password"
              placeholder="비밀번호를 다시 입력해주세요"
              value={form.passwordConfirm}
              onChange={e => set("passwordConfirm", e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button
            type="submit"
            style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? "가입 중..." : "회원가입"}
          </button>
        </form>

        <div style={s.links}>
          <span style={s.linkText}>이미 계정이 있으신가요?</span>
          <Link href="/worker/login" style={s.link}>로그인</Link>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100dvh",
    backgroundColor: "#f9fafb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: "32px 28px",
    border: "1px solid #f3f4f6",
    boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
  },
  logoWrap: { textAlign: "center", marginBottom: 28 },
  logoText: { fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", marginBottom: 6 },
  logoSub: { fontSize: 14, color: "#9ca3af", fontWeight: 500, margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: 18 },
  fieldGroup: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: "#374151" },
  input: {
    height: 48,
    padding: "0 14px",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    fontSize: 15,
    color: "#111827",
    outline: "none",
    background: "#fafafa",
    fontFamily: "inherit",
    boxSizing: "border-box" as const,
  },
  hint: { fontSize: 12, color: "#9ca3af", margin: 0 },
  error: {
    padding: "10px 14px",
    background: "#fef2f2",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
    color: "#dc2626",
    textAlign: "center" as const,
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
  link: { fontSize: 14, color: "#111827", fontWeight: 700, textDecoration: "none" },
};
