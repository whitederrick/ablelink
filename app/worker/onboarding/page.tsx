"use client";
// app/worker/onboarding/page.tsx
// 직무지도원 최초 로그인 온보딩 — 아이디 확정 + 비밀번호 변경 강제

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Step = "choose-id" | "verify-email" | "set-password";

export default function OnboardingPage() {
  const router = useRouter();
  const [currentLoginId, setCurrentLoginId] = useState("");
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("choose-id");

  // 이메일 입력
  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // 인증 코드
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [confirmedLoginId, setConfirmedLoginId] = useState(""); // "" = 아직 미확정

  // 비밀번호
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/worker/onboarding")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setCurrentLoginId(d.user.loginId);
          setUserName(d.user.userName);
          if (!d.user.isTemporary) router.replace("/worker/home");
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  // ── 전화번호를 아이디로 유지 ──────────────────────────────────────
  async function handleConfirmPhone() {
    setConfirmedLoginId(currentLoginId);
    setStep("set-password");
  }

  // ── 이메일 인증 요청 ──────────────────────────────────────────────
  async function handleRequestEmail() {
    setError("");
    setEmailSending(true);
    try {
      const res = await fetch("/api/worker/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request-email", email }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setEmailSent(true);
      setStep("verify-email");
    } catch (e: any) {
      setError(e.message || "이메일 발송에 실패했습니다.");
    } finally {
      setEmailSending(false);
    }
  }

  // ── 이메일 인증 코드 확인 ─────────────────────────────────────────
  async function handleVerifyEmail() {
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/worker/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify-email", code }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      setConfirmedLoginId(data.newLoginId);
      setStep("set-password");
    } catch (e: any) {
      setError(e.message || "인증에 실패했습니다.");
    } finally {
      setVerifying(false);
    }
  }

  // ── 비밀번호 변경 + 완료 ─────────────────────────────────────────
  async function handleSetPassword() {
    setError("");
    if (pw.length < 8) { setError("비밀번호는 8자 이상이어야 합니다."); return; }
    if (pw !== pwConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/worker/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-password", newPassword: pw, confirmPassword: pwConfirm }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);
      router.replace("/worker/home");
    } catch (e: any) {
      setError(e.message || "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        {/* 헤더 */}
        <div style={s.header}>
          <p style={{ fontSize: 13, opacity: 0.8, margin: "0 0 6px" }}>환영합니다, {userName}님</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>AbleLink 초기 설정</h1>
          <p style={{ fontSize: 13, opacity: 0.75, margin: "8px 0 0", lineHeight: 1.6 }}>
            아이디와 비밀번호를 설정하면 서비스를 이용하실 수 있습니다.
          </p>
        </div>

        {/* 진행 단계 표시 */}
        <div style={s.steps}>
          {[
            { key: "choose-id",    label: "아이디 선택" },
            { key: "set-password", label: "비밀번호 설정" },
          ].map((st, i) => {
            const done = (st.key === "choose-id" && step === "set-password") ||
                         (st.key === "verify-email" && step === "set-password");
            const active = step === st.key || (st.key === "choose-id" && step === "verify-email");
            return (
              <div key={st.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {i > 0 && <div style={{ width: 24, height: 1, background: "#e5e7eb" }} />}
                <div style={{
                  display: "flex", alignItems: "center", gap: 6,
                  color: done ? "#16a34a" : active ? "#2563eb" : "#9ca3af",
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700,
                    background: done ? "#dcfce7" : active ? "#eff6ff" : "#f3f4f6",
                    color: done ? "#16a34a" : active ? "#2563eb" : "#9ca3af",
                    border: `1.5px solid ${done ? "#86efac" : active ? "#93c5fd" : "#e5e7eb"}`,
                  }}>
                    {done ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: active || done ? 600 : 400 }}>{st.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={s.body}>
          {/* ── STEP 1: 아이디 선택 ── */}
          {(step === "choose-id" || step === "verify-email") && (
            <>
              {step === "choose-id" && (
                <>
                  <p style={s.desc}>사용하실 아이디를 선택해 주세요.</p>

                  {/* 전화번호 유지 */}
                  <div style={s.optionBox}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>전화번호로 사용</p>
                        <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>{currentLoginId}</p>
                        <p style={{ fontSize: 11, color: "#9ca3af", margin: "4px 0 0" }}>추가 인증 없이 바로 사용 가능합니다.</p>
                      </div>
                      <button onClick={handleConfirmPhone} style={s.btnPrimary}>선택</button>
                    </div>
                  </div>

                  <div style={{ textAlign: "center", color: "#d1d5db", fontSize: 12, margin: "12px 0" }}>또는</div>

                  {/* 이메일로 변경 */}
                  <div style={s.optionBox}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 10px" }}>이메일로 변경</p>
                    <input
                      type="email"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setError(""); }}
                      placeholder="example@email.com"
                      style={s.input}
                    />
                    {error && <p style={s.error}>{error}</p>}
                    <button
                      onClick={handleRequestEmail}
                      disabled={!email || emailSending}
                      style={{ ...s.btnOutline, marginTop: 10, opacity: email && !emailSending ? 1 : 0.5 }}
                    >
                      {emailSending ? "발송 중..." : "인증 코드 받기"}
                    </button>
                  </div>
                </>
              )}

              {step === "verify-email" && (
                <>
                  <p style={s.desc}>
                    <strong>{email}</strong>으로 인증 코드를 발송했습니다.<br />
                    받으신 6자리 코드를 입력해 주세요. (10분 유효)
                  </p>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                    placeholder="123456"
                    style={{ ...s.input, textAlign: "center", letterSpacing: 8, fontSize: 20, fontWeight: 700 }}
                  />
                  {error && <p style={s.error}>{error}</p>}
                  <button
                    onClick={handleVerifyEmail}
                    disabled={code.length !== 6 || verifying}
                    style={{ ...s.btnPrimary, width: "100%", marginTop: 12, opacity: code.length === 6 && !verifying ? 1 : 0.5 }}
                  >
                    {verifying ? "확인 중..." : "인증 확인"}
                  </button>
                  <button
                    onClick={() => { setStep("choose-id"); setCode(""); setError(""); setEmailSent(false); }}
                    style={{ ...s.btnText, marginTop: 10 }}
                  >
                    다시 입력하기
                  </button>
                </>
              )}
            </>
          )}

          {/* ── STEP 2: 비밀번호 설정 ── */}
          {step === "set-password" && (
            <>
              <div style={{ padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, marginBottom: 20, fontSize: 13 }}>
                <p style={{ margin: 0, color: "#15803d" }}>
                  ✓ 아이디가 확정되었습니다: <strong>{confirmedLoginId}</strong>
                </p>
              </div>

              <p style={s.desc}>앞으로 사용하실 비밀번호를 설정해 주세요. (8자 이상)</p>

              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>새 비밀번호</label>
                <input
                  type="password"
                  value={pw}
                  onChange={e => { setPw(e.target.value); setError(""); }}
                  placeholder="8자 이상 입력"
                  style={s.input}
                />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={s.label}>비밀번호 확인</label>
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={e => { setPwConfirm(e.target.value); setError(""); }}
                  placeholder="비밀번호를 다시 입력"
                  style={s.input}
                />
                {pwConfirm && pw !== pwConfirm && (
                  <p style={{ fontSize: 11, color: "#dc2626", margin: "4px 0 0" }}>비밀번호가 일치하지 않습니다.</p>
                )}
              </div>

              {error && <p style={s.error}>{error}</p>}

              <button
                onClick={handleSetPassword}
                disabled={pw.length < 8 || pw !== pwConfirm || saving}
                style={{
                  ...s.btnPrimary,
                  width: "100%",
                  opacity: pw.length >= 8 && pw === pwConfirm && !saving ? 1 : 0.5,
                }}
              >
                {saving ? "저장 중..." : "완료 — 서비스 시작하기"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:      { minHeight: "100dvh", background: "#f9fafb", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" },
  card:      { width: "100%", maxWidth: 440, background: "#fff", borderRadius: 20, boxShadow: "0 8px 32px rgba(0,0,0,0.10)", overflow: "hidden" },
  center:    { minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" },
  spinner:   { width: 28, height: 28, border: "2.5px solid #e5e7eb", borderTop: "2.5px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header:    { background: "linear-gradient(135deg, #1e3a8a, #2563eb)", color: "#fff", padding: "28px 24px 20px", textAlign: "center" as const },
  steps:     { display: "flex", justifyContent: "center", alignItems: "center", gap: 4, padding: "16px 24px", borderBottom: "1px solid #f3f4f6" },
  body:      { padding: "20px 24px 28px" },
  desc:      { fontSize: 13, color: "#6b7280", lineHeight: 1.7, margin: "0 0 18px" },
  optionBox: { border: "1px solid #e5e7eb", borderRadius: 12, padding: "16px", marginBottom: 0 },
  input:     { width: "100%", height: 44, border: "1px solid #e5e7eb", borderRadius: 10, padding: "0 14px", fontSize: 14, boxSizing: "border-box" as const, outline: "none" },
  label:     { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 },
  error:     { fontSize: 12, color: "#dc2626", margin: "6px 0 0" },
  btnPrimary: { padding: "11px 20px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" },
  btnOutline: { width: "100%", padding: "11px", background: "#fff", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" },
  btnText:   { display: "block", width: "100%", padding: "8px", background: "none", border: "none", color: "#9ca3af", fontSize: 12, cursor: "pointer", textAlign: "center" as const },
};
