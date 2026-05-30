"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Building2, CheckCircle2, KeyRound, Lock, Shield, User, XCircle } from "lucide-react";

type Step = "verify" | "info" | "terms" | "done";

interface InviteInfo {
  agencyName: string;
  siteName: string | null;
  phoneNumber: string;
  workerName: string | null;
  expiresAt: string;
}

const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";

export default function InvitePage() {
  const router = useRouter();
  const { id }  = useParams<{ id: string }>();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [step,   setStep]   = useState<Step>("verify");

  const [code,   setCode]   = useState("");
  const [name,   setName]   = useState("");
  const [pw,     setPw]     = useState("");
  const [pwConf, setPwConf] = useState("");
  const [consentTerms,    setConsentTerms]    = useState(false);
  const [consentPrivacy,  setConsentPrivacy]  = useState(false);
  const [consentLocation, setConsentLocation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    fetch(`/api/worker/invite/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setInvite(d.invite);
          if (d.invite.workerName) setName(d.invite.workerName);
        } else {
          setInvalid(true);
        }
      })
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleVerifyCode() {
    setError("");
    if (code.length !== 6) { setError("6자리 인증번호를 입력해주세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/worker/invite/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setStep("info");
    } catch { setError("서버와 연결할 수 없습니다."); }
    finally { setSubmitting(false); }
  }

  async function handleSubmit() {
    setError("");
    if (!consentTerms || !consentPrivacy) { setError("필수 약관에 동의해주세요."); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/worker/invite/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "signup",
          code, workerName: name, password: pw,
          consentTerms, consentPrivacy, consentLocation,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setStep("done");
      setTimeout(() => router.replace(data.hasSite ? "/worker/home" : "/worker/site/register"), 2000);
    } catch { setError("서버와 연결할 수 없습니다."); }
    finally { setSubmitting(false); }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
      </div>
    );
  }

  if (invalid) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5">
        <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl shadow-slate-950/10">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-rose-400" />
          <p className="text-lg font-black text-slate-900">유효하지 않은 초대 링크</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">링크가 만료되었거나 이미 사용된 초대입니다.</p>
          <Link href="/worker/login" className="mt-6 block text-sm font-black text-sky-600">로그인 페이지로 이동</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-5 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-xl shadow-slate-950/10">

        {/* 헤더 */}
        <div className="bg-slate-950 px-6 py-7 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
            <KeyRound className="h-6 w-6 text-sky-400" />
          </div>
          <p className="mb-1 text-xs font-semibold text-slate-400">초대장</p>
          <h1 className="text-xl font-black text-white">AbleLink 가입</h1>
          {invite && (
            <div className="mt-3 rounded-xl bg-white/10 px-4 py-3">
              <p className="flex items-center justify-center gap-1.5 text-sm font-black text-white">
                <Building2 className="h-4 w-4 text-sky-400" />
                {invite.agencyName}
              </p>
              {invite.siteName && (
                <p className="mt-0.5 text-xs font-semibold text-slate-400">{invite.siteName}</p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4 px-6 py-6">

          {/* STEP 1: 인증번호 확인 */}
          {step === "verify" && invite && (
            <>
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">가입 전화번호</p>
                <p className="mt-1 text-base font-black text-slate-900">{invite.phoneNumber.replace(/(\d{3})(\d{4})(\d{4})/, "$1-$2-$3")}</p>
              </div>
              <p className="text-sm font-semibold text-slate-500">
                에이전시에서 전달받은 <strong className="font-black text-slate-800">6자리 인증번호</strong>를 입력해주세요.
              </p>
              <input
                type="text" inputMode="numeric" maxLength={6}
                value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                placeholder="123456"
                className="h-14 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-center text-2xl font-black tracking-[10px] text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              />
              <button onClick={handleVerifyCode} disabled={submitting || code.length !== 6}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-50">
                {submitting ? "확인 중..." : <><CheckCircle2 className="h-4 w-4" /> 다음</>}
              </button>
            </>
          )}

          {/* STEP 2: 기본 정보 */}
          {step === "info" && (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-500" />
                <p className="text-xs font-black text-emerald-700">인증번호 확인 완료</p>
              </div>
              <div>
                <label className="mb-2 block text-xs font-black text-slate-700">
                  <User className="mr-1 inline h-3.5 w-3.5 text-slate-400" /> 성명
                </label>
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
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white transition active:scale-[0.97] disabled:opacity-50">
                다음
              </button>
            </>
          )}

          {/* STEP 3: 약관 동의 */}
          {step === "terms" && (
            <>
              <p className="text-sm font-semibold text-slate-500">아래 약관에 동의해주세요.</p>

              <button
                onClick={() => {
                  const all = !(consentTerms && consentPrivacy && consentLocation);
                  setConsentTerms(all); setConsentPrivacy(all); setConsentLocation(all);
                }}
                className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition ${
                  consentTerms && consentPrivacy && consentLocation ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${
                  consentTerms && consentPrivacy && consentLocation ? "border-sky-500 bg-sky-500" : "border-slate-300"
                }`}>
                  {consentTerms && consentPrivacy && consentLocation && (
                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 10"><path d="M1 5l3 3L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  )}
                </div>
                <span className="text-sm font-black text-slate-900">전체 동의</span>
              </button>

              <div className="space-y-2">
                {[
                  { key: "terms",    label: "서비스 이용약관",   required: true,  checked: consentTerms,    set: setConsentTerms,    href: "/terms" },
                  { key: "privacy",  label: "개인정보처리방침",   required: true,  checked: consentPrivacy,  set: setConsentPrivacy,  href: "/privacy" },
                  { key: "location", label: "위치정보 이용 동의", required: false, checked: consentLocation, set: setConsentLocation, href: null },
                ].map(item => (
                  <div key={item.key} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
                    <button onClick={() => item.set(!item.checked)}
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border-2 transition ${item.checked ? "border-sky-500 bg-sky-500" : "border-slate-300"}`}>
                      {item.checked && <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 12 10"><path d="M1 5l3 3L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                    </button>
                    <div className="flex flex-1 items-center justify-between">
                      <span className="text-sm font-semibold text-slate-700">
                        <span className={`mr-1 text-xs font-black ${item.required ? "text-rose-500" : "text-slate-400"}`}>
                          {item.required ? "[필수]" : "[선택]"}
                        </span>
                        {item.label}
                      </span>
                      {item.href && <Link href={item.href} target="_blank" className="text-xs font-black text-sky-600">보기</Link>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                <p className="flex items-start gap-2 text-xs font-semibold leading-relaxed text-amber-700">
                  <Shield className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  위치정보 동의 미선택 시 GPS 출퇴근 기록 기능이 제한될 수 있습니다.
                </p>
              </div>

              <button onClick={handleSubmit} disabled={submitting || !consentTerms || !consentPrivacy}
                className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-50">
                {submitting ? "가입 중..." : <><CheckCircle2 className="h-4 w-4" /> 가입 완료</>}
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
        </div>
      </div>
    </main>
  );
}
