"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, KeyRound, Lock, Mail, Phone } from "lucide-react";

type Step = "choose-id" | "verify-email" | "set-password";

export default function OnboardingPage() {
  const router = useRouter();
  const [currentLoginId, setCurrentLoginId] = useState("");
  const [workerName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("choose-id");

  const [email, setEmail] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [confirmedLoginId, setConfirmedLoginId] = useState("");

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
          setUserName(d.user.workerName);
          if (!d.user.isTemporary) router.replace("/worker/home");
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleConfirmPhone() {
    setConfirmedLoginId(currentLoginId);
    setStep("set-password");
  }

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
      setStep("verify-email");
    } catch (e: any) {
      setError(e.message || "이메일 발송에 실패했습니다.");
    } finally {
      setEmailSending(false);
    }
  }

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
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
      </div>
    );
  }

  const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";

  const STEPS = [
    { key: "choose-id",    label: "아이디 선택" },
    { key: "set-password", label: "비밀번호 설정" },
  ];
  const stepIndex = step === "set-password" ? 1 : 0;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl shadow-slate-950/10">

        {/* 헤더 */}
        <div className="bg-slate-950 px-6 py-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <KeyRound className="h-6 w-6 text-sky-400" aria-hidden="true" />
          </div>
          <p className="mb-1 text-xs font-semibold text-slate-400">환영합니다, {workerName}님</p>
          <h1 className="text-xl font-black text-white">AbleLink 초기 설정</h1>
          <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-400">
            아이디와 비밀번호를 설정하면 서비스를 이용하실 수 있습니다.
          </p>
        </div>

        {/* 스텝 인디케이터 */}
        <div className="flex items-center justify-center gap-3 border-b border-slate-100 px-6 py-3">
          {STEPS.map((st, i) => {
            const isDone = i < stepIndex;
            const isActive = i === stepIndex;
            return (
              <div key={st.key} className="flex items-center gap-2">
                {i > 0 && <div className="h-px w-6 bg-slate-200" />}
                <div className={`flex items-center gap-1.5 text-xs font-black ${
                  isDone ? "text-emerald-600" : isActive ? "text-sky-600" : "text-slate-400"
                }`}>
                  <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black ${
                    isDone ? "border-emerald-300 bg-emerald-50 text-emerald-600"
                      : isActive ? "border-sky-300 bg-sky-50 text-sky-600"
                      : "border-slate-200 bg-slate-50 text-slate-400"
                  }`}>
                    {isDone ? "✓" : i + 1}
                  </div>
                  {st.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* 바디 */}
        <div className="space-y-4 px-6 py-6">

          {/* STEP 1: 아이디 선택 */}
          {step === "choose-id" && (
            <>
              <p className="text-sm font-semibold leading-relaxed text-slate-500">사용하실 아이디를 선택해 주세요.</p>

              {/* 전화번호 유지 */}
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
                      <Phone className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-900">전화번호로 사용</p>
                      <p className="mt-0.5 text-sm font-semibold text-slate-600">{currentLoginId}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-400">추가 인증 없이 바로 사용 가능합니다.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleConfirmPhone}
                    className="flex-shrink-0 rounded-xl bg-slate-950 px-4 py-2 text-xs font-black text-white transition active:scale-95"
                  >
                    선택
                  </button>
                </div>
              </div>

              <div className="text-center text-xs font-semibold text-slate-400">또는</div>

              {/* 이메일로 변경 */}
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100">
                    <Mail className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-black text-slate-900">이메일로 변경</p>
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  placeholder="example@email.com"
                  className={inputCls}
                />
                {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
                <button
                  onClick={handleRequestEmail}
                  disabled={!email || emailSending}
                  className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-sky-500 text-sm font-black text-sky-600 transition active:scale-[0.97] disabled:opacity-50"
                >
                  {emailSending ? "발송 중..." : "인증 코드 받기"}
                </button>
              </div>
            </>
          )}

          {/* STEP 1b: 이메일 인증 코드 */}
          {step === "verify-email" && (
            <>
              <p className="text-sm font-semibold leading-relaxed text-slate-500">
                <strong className="font-black text-slate-800">{email}</strong>으로 인증 코드를 발송했습니다.<br />
                받으신 6자리 코드를 입력해 주세요. (10분 유효)
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                placeholder="123456"
                className="h-14 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-center text-2xl font-black tracking-[10px] text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
              {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
              <button
                onClick={handleVerifyEmail}
                disabled={code.length !== 6 || verifying}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-50"
              >
                {verifying ? "확인 중..." : <><CheckCircle2 className="h-4 w-4" /> 인증 확인</>}
              </button>
              <button
                onClick={() => { setStep("choose-id"); setCode(""); setError(""); }}
                className="w-full py-2 text-xs font-semibold text-slate-400 transition hover:text-slate-600"
              >
                다시 입력하기
              </button>
            </>
          )}

          {/* STEP 2: 비밀번호 설정 */}
          {step === "set-password" && (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" aria-hidden="true" />
                <p className="text-xs font-black text-emerald-700">
                  아이디 확정: <span className="font-black">{confirmedLoginId}</span>
                </p>
              </div>

              <p className="text-sm font-semibold leading-relaxed text-slate-500">앞으로 사용하실 비밀번호를 설정해 주세요. (8자 이상)</p>

              <div className="space-y-3">
                <div>
                  <label className="mb-2 block text-xs font-black text-slate-700">새 비밀번호</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      type="password"
                      value={pw}
                      onChange={e => { setPw(e.target.value); setError(""); }}
                      placeholder="8자 이상 입력"
                      className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-black text-slate-700">비밀번호 확인</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      type="password"
                      value={pwConfirm}
                      onChange={e => { setPwConfirm(e.target.value); setError(""); }}
                      placeholder="비밀번호를 다시 입력"
                      className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    />
                  </div>
                  {pwConfirm && pw !== pwConfirm && (
                    <p className="mt-1.5 text-xs font-semibold text-rose-600">비밀번호가 일치하지 않습니다.</p>
                  )}
                </div>
              </div>

              {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

              <button
                onClick={handleSetPassword}
                disabled={pw.length < 8 || pw !== pwConfirm || saving}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-50"
              >
                {saving ? "저장 중..." : <><ArrowRight className="h-4 w-4" /> 완료 — 서비스 시작하기</>}
              </button>
            </>
          )}

        </div>
      </div>
    </main>
  );
}
