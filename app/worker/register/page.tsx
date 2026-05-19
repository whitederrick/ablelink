"use client";
// app/worker/register/page.tsx
// 직무지도원 회원가입

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
    <div style={s.wrap}>
      <div style={s.inner}>
        <div style={s.header}>
          <Link href="/worker/login" style={s.back}>← 돌아가기</Link>
          <h1 style={s.title}>회원가입</h1>
        </div>

        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.group}>
            <label style={s.label}>이름 *</label>
            <input
              style={s.input}
              placeholder="홍길동"
              value={form.userName}
              onChange={e => set("userName", e.target.value)}
              required
            />
          </div>

          <div style={s.group}>
            <label style={s.label}>아이디 (휴대전화번호) *</label>
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

          <div style={s.group}>
            <label style={s.label}>비밀번호 *</label>
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

          <div style={s.group}>
            <label style={s.label}>비밀번호 확인 *</label>
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

          {error && <p style={s.error}>{error}</p>}

          <button
            type="submit"
            style={{ ...s.btn, opacity: loading ? 0.7 : 1 }}
            disabled={loading}
          >
            {loading ? "가입 중..." : "회원가입"}
          </button>
        </form>

        <p style={s.loginLink}>
          이미 계정이 있으신가요?{" "}
          <Link href="/worker/login" style={s.link}>로그인</Link>
        </p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { minHeight: "100dvh", backgroundColor: "#f8f9ff", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  inner: { width: "100%", maxWidth: 420, backgroundColor: "#fff", borderRadius: 20, padding: "32px 28px", boxShadow: "0 4px 24px rgba(88,101,242,0.10)" },
  header: { marginBottom: 28 },
  back: { fontSize: 14, color: "#5865F2", textDecoration: "none" },
  title: { fontSize: 24, fontWeight: 700, color: "#333", margin: "8px 0 0" },
  form: { display: "flex", flexDirection: "column", gap: 18 },
  group: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 13, fontWeight: 600, color: "#555" },
  input: { height: 48, border: "none", borderBottom: "1.5px solid #ddd", fontSize: 16, color: "#333", backgroundColor: "transparent", outline: "none", padding: "0 4px" },
  hint: { fontSize: 12, color: "#aaa", margin: 0 },
  error: { color: "#e53935", fontSize: 13, backgroundColor: "#fff5f5", padding: "10px 14px", borderRadius: 8, margin: 0, textAlign: "center" },
  btn: { height: 52, backgroundColor: "#5865F2", color: "#fff", fontSize: 17, fontWeight: 700, border: "none", borderRadius: 10, cursor: "pointer", marginTop: 4 },
  loginLink: { textAlign: "center", fontSize: 14, color: "#888", marginTop: 20 },
  link: { color: "#5865F2", fontWeight: 600, textDecoration: "none" },
};
