"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Lock, Phone, Shield, User } from "lucide-react";

type Step = "phone" | "otp" | "info" | "terms" | "done";

const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";

function StepBar({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "phone", label: "전화번호" },
    { key: "info",  label: "정보 입력" },
    { key: "terms", label: "약관 동의" },
  ];
  const idx = step === "phone" ? 0 : step === "otp" ? 0 : step === "info" ? 1 : step === "terms" ? 2 : 3;
  return (
    <div className="flex items-center justify-center gap-2 border-b border-slate-100 px-6 py-3">
      {steps.map((s, i) => {
        const done   = i < idx;
        const active = i === idx;
        return (
          <div key={s.key} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-8 bg-slate-200" />}
            <div className={`flex items-center gap-1.5 text-xs font-black ${done ? "text-emerald-600" : active ? "text-sky-600" : "text-slate-300"}`}>
              <div className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-black ${done ? "border-emerald-300 bg-emerald-50 text-emerald-600" : active ? "border-sky-300 bg-sky-50 text-sky-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                {done ? "✓" : i + 1}
              </div>
              {s.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function WorkerSignupPage() {
  const router = useRouter();
  const [step,    setStep]    = useState<Step>("phone");
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");
  const [name,    setName]    = useState("");
  const [pw,      setPw]      = useState("");
  const [pwConf,  setPwConf]  = useState("");
  const [consentTerms,    setConsentTerms]    = useState(false);
  const [consentPrivacy,  setConsentPrivacy]  = useState(false);
  const [consentLocation, setConsentLocation] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [countdown, setCountdown] = useState(0);

  function startCountdown() {
    setCountdown(300);
    const t = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleRequestOtp() {
    setError("");
    const cleaned = phone.replace(/-/g, "");
    if (!/^01[0-9]{8,9}$/.test(cleaned)) { setError("올바른 휴대전화번호를 입력해주세요."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/worker/phone-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", phoneNumber: cleaned }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setOtpSent(true);
      startCountdown();
      setStep("otp");
    } catch { setError("서버와 연결할 수 없습니다."); }
    finally { setLoading(false); }
  }

  async function handleVerifyOtp() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/worker/phone-verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm", phoneNumber: phone.replace(/-/g, ""), code: otp }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setStep("info");
    } catch { setError("서버와 연결할 수 없습니다."); }
    finally { setLoading(false); }
  }

  async function handleSubmit() {
    setError("");
    if (!consentTerms || !consentPrivacy) { setError("필수 약관에 동의해주세요."); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/worker/auth/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phone.replace(/-/g, ""),
          workerName: name, password: pw,
          consentTerms, consentPrivacy, consentLocation,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setStep("done");
      setTimeout(() => router.replace("/worker/site/register"), 2000);
    } catch { setError("서버와 연결할 수 없습니다."); }
    finally { setLoading(false); }
  }

  const allConsented = consentTerms && consentPrivacy;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl shadow-slate-950/10">

        {/* 헤더 */}
        <div className="bg-slate-950 px-6 py-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <User className="h-6 w-6 text-sky-400" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-black text-white">직무지도원 회원가입</h1>
          <p className="mt-2 text-xs font-semibold leading-relaxed text-slate-400">
            전화번호 인증 후 가입을 완료해주세요.
          </p>
        </div>

        <StepBar step={step} />

        <div className="space-y-4 px-6 py-6">

          {/* STEP 1: 전화번호 입력 */}
          {(step === "phone" || step === "otp") && (
            <>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">
                  <Phone className="mr-1 inline h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                  휴대전화번호
                </label>
                <input
                  type="tel" placeholder="01012345678"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setError(""); }}
                  className={inputCls}
                  disabled={step === "otp"}
                />
                {step === "phone" && (
                  <button onClick={handleRequestOtp} disabled={loading || !phone}
                    className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-50">
                    {loading ? "발송 중..." : "인증번호 받기"}
                  </button>
                )}
              </div>

              {step === "otp" && (
                <>
                  <div>
                    <label className="mb-2 block text-xs font-black text-slate-700">인증번호 6자리</label>
                    <input
                      type="text" inputMode="numeric" maxLength={6}
                      value={otp} onChange={e => { setOtp(e.target.value.replace(/\D/g, "")); setError(""); }}
                      placeholder="123456"
                      className="h-14 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-center text-2xl font-black tracking-[10px] text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
                    />
                    <p className="mt-1.5 text-center text-xs font-semibold text-slate-400">
                      {countdown > 0
                        ? `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, "0")} 남음`
                        : "인증번호가 만료되었습니다."}
                    </p>
                  </div>
                  <button onClick={handleVerifyOtp} disabled={loading || otp.length !== 6}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-50">
                    {loading ? "확인 중..." : <><CheckCircle2 className="h-4 w-4" /> 인증 확인</>}
                  </button>
                  <button onClick={() => { setStep("phone"); setOtp(""); setError(""); }}
                    className="w-full py-2 text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">
                    전화번호 다시 입력
                  </button>
                  {!otpSent || countdown === 0 ? (
                    <button onClick={handleRequestOtp} disabled={loading}
                      className="w-full py-2 text-center text-xs font-semibold text-sky-600 transition hover:text-sky-700">
                      인증번호 재발송
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}

          {/* STEP 2: 기본 정보 */}
          {step === "info" && (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                <p className="text-xs font-black text-emerald-700">{phone} 인증 완료</p>
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">성명</label>
                <input type="text" placeholder="홍길동" value={name} onChange={e => { setName(e.target.value); setError(""); }} className={inputCls} />
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">비밀번호 (8자 이상)</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input type="password" placeholder="8자 이상" value={pw} onChange={e => { setPw(e.target.value); setError(""); }}
                    className={`${inputCls} pl-10`} />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">비밀번호 확인</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input type="password" placeholder="비밀번호 재입력" value={pwConf} onChange={e => { setPwConf(e.target.value); setError(""); }}
                    className={`${inputCls} pl-10`} />
                </div>
                {pwConf && pw !== pwConf && <p className="mt-1 text-xs font-semibold text-rose-600">비밀번호가 일치하지 않습니다.</p>}
              </div>
              <button
                onClick={() => {
                  if (name.trim().length < 2) { setError("이름은 2자 이상이어야 합니다."); return; }
                  if (pw.length < 8) { setError("비밀번호는 8자 이상이어야 합니다."); return; }
                  if (pw !== pwConf) { setError("비밀번호가 일치하지 않습니다."); return; }
                  setError(""); setStep("terms");
                }}
                disabled={!name || pw.length < 8 || pw !== pwConf}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-50">
                다음 <ArrowRight className="h-4 w-4" />
              </button>
            </>
          )}

          {/* STEP 3: 약관 동의 */}
          {step === "terms" && (
            <>
              <div>
                <p className="mb-4 text-sm font-semibold text-slate-500">아래 약관을 확인하고 동의해주세요.</p>

                {/* 전체 동의 */}
                <button
                  onClick={() => {
                    const all = !(consentTerms && consentPrivacy && consentLocation);
                    setConsentTerms(all); setConsentPrivacy(all); setConsentLocation(all);
                  }}
                  className={`mb-4 flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition ${
                    consentTerms && consentPrivacy && consentLocation
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                    consentTerms && consentPrivacy && consentLocation ? "border-sky-500 bg-sky-500" : "border-slate-300"
                  }`}>
                    {consentTerms && consentPrivacy && consentLocation && (
                      <svg className="h-3 w-3 text-white" fill="currentColor" viewBox="0 0 12 10"><path d="M1 5l3 3L11 1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </div>
                  <span className="text-sm font-black text-slate-900">전체 동의</span>
                </button>

                <div className="space-y-2">
                  {[
                    { key: "terms",    label: "서비스 이용약관",       required: true,  checked: consentTerms,    set: setConsentTerms,    href: "/terms" },
                    { key: "privacy",  label: "개인정보처리방침",       required: true,  checked: consentPrivacy,  set: setConsentPrivacy,  href: "/privacy" },
                    { key: "location", label: "위치정보 이용 동의",     required: false, checked: consentLocation, set: setConsentLocation, href: null },
                  ].map(item => (
                    <div key={item.key} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
                      <button onClick={() => item.set(!item.checked)}
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition ${
                          item.checked ? "border-sky-500 bg-sky-500" : "border-slate-300"
                        }`}>
                        {item.checked && (
                          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 10"><path d="M1 5l3 3L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                      </button>
                      <div className="flex flex-1 items-center justify-between">
                        <span className="text-sm font-semibold text-slate-700">
                          <span className={`mr-1 text-xs font-black ${item.required ? "text-rose-500" : "text-slate-400"}`}>
                            {item.required ? "[필수]" : "[선택]"}
                          </span>
                          {item.label}
                        </span>
                        {item.href && (
                          <Link href={item.href} target="_blank"
                            className="text-xs font-black text-sky-600 transition hover:text-sky-700">
                            보기
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-amber-700">
                    <Shield className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    위치정보 동의는 선택 사항이나, 미동의 시 GPS 출퇴근 기록 기능이 제한될 수 있습니다.
                  </p>
                </div>
              </div>

              <button onClick={handleSubmit} disabled={loading || !allConsented}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-50">
                {loading ? "가입 중..." : <><CheckCircle2 className="h-4 w-4" /> 가입 완료</>}
              </button>
            </>
          )}

          {/* 완료 */}
          {step === "done" && (
            <div className="py-4 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <p className="text-lg font-black text-slate-900">가입 완료!</p>
              <p className="mt-2 text-sm font-semibold text-slate-500">잠시 후 서비스로 이동합니다.</p>
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          {step !== "done" && (
            <p className="text-center text-sm">
              <span className="font-semibold text-slate-500">이미 계정이 있으신가요? </span>
              <Link href="/worker/login" className="font-black text-sky-600">로그인</Link>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
