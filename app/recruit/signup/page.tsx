"use client";

// 마켓플레이스 직종 증명형 회원가입 (직무지도원/요양보호사/활동지원사 자격 선택·증명)
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, ShieldCheck } from "lucide-react";

const PROFS: { value: string; label: string; certHint: string }[] = [
  { value: "JOB_COACH", label: "직무지도원", certHint: "직무지도원 양성과정 수료증 번호" },
  { value: "CAREGIVER", label: "요양보호사", certHint: "요양보호사 국가자격증 번호" },
  { value: "ACTIVITY_ASSISTANT", label: "활동지원사", certHint: "활동지원사 교육과정 수료증 번호" },
];

type ProfState = { checked: boolean; certNumber: string; experienceYears: string };

export default function RecruitSignupPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [profs, setProfs] = useState<Record<string, ProfState>>(
    Object.fromEntries(PROFS.map((p) => [p.value, { checked: false, certNumber: "", experienceYears: "" }])),
  );
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [location, setLocation] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const setProf = (k: string, patch: Partial<ProfState>) => setProfs((p) => ({ ...p, [k]: { ...p[k], ...patch } }));

  async function requestOtp() {
    if (!/^01[0-9]{8,9}$/.test(phone.replace(/-/g, ""))) { setError("올바른 휴대전화번호를 입력해주세요."); return; }
    setError(""); setOtpLoading(true);
    try {
      const r = await fetch("/api/worker/phone-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request", phoneNumber: phone }) });
      const d = await r.json();
      if (r.ok) setOtpSent(true);
      else setError(d.message || "인증번호 발송에 실패했습니다.");
    } finally { setOtpLoading(false); }
  }

  async function confirmOtp() {
    setError(""); setOtpLoading(true);
    try {
      const r = await fetch("/api/worker/phone-verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "confirm", phoneNumber: phone, code }) });
      const d = await r.json();
      if (r.ok && d.success) setPhoneVerified(true);
      else setError(d.message || "인증번호가 올바르지 않습니다.");
    } finally { setOtpLoading(false); }
  }

  async function submit() {
    setError("");
    if (!phoneVerified) { setError("휴대전화 인증을 완료해주세요."); return; }
    if (name.trim().length < 2) { setError("이름을 입력해주세요."); return; }
    if (password.length < 8) { setError("비밀번호는 8자 이상이어야 합니다."); return; }
    const selected = PROFS.filter((p) => profs[p.value].checked);
    if (!terms || !privacy) { setError("필수 약관에 동의해주세요."); return; }

    setSubmitting(true);
    try {
      const r = await fetch("/api/recruit/auth/signup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: phone, workerName: name, password,
          consentTerms: terms, consentPrivacy: privacy, consentLocation: location,
          professions: selected.map((p) => ({
            profession: p.value,
            certNumber: profs[p.value].certNumber.trim() || null,
            experienceYears: Number(profs[p.value].experienceYears) || 0,
          })),
        }),
      });
      const d = await r.json();
      if (d.success) router.replace("/recruit");
      else setError(d.message || "가입에 실패했습니다.");
    } finally { setSubmitting(false); }
  }

  const inputCls = "h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="mx-auto max-w-md pb-28">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-4">
          <button onClick={() => router.back()} className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 active:scale-95"><ChevronLeft className="h-5 w-5" /></button>
          <h1 className="text-base font-black text-slate-900">인력풀 회원가입</h1>
        </header>

        <div className="space-y-3 px-4 pt-3">
          <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-xs font-semibold leading-relaxed text-sky-700">
            <ShieldCheck className="mb-1 h-4 w-4" />
            직무지도원·요양보호사·활동지원사 자격을 등록하고 직무지도 공고에 지원하거나, 에이전시의 제안을 받을 수 있어요. 자격은 운영자 검증 후 활성화됩니다.
          </div>

          {/* 1. 휴대폰 인증 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">1. 휴대폰 인증</p>
            <div className="flex gap-2">
              <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="휴대전화번호 ('-' 없이)" inputMode="numeric" disabled={phoneVerified} />
              <button type="button" onClick={requestOtp} disabled={otpLoading || phoneVerified} className="flex-shrink-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 active:scale-95 disabled:opacity-50">
                {otpSent ? "재전송" : "인증요청"}
              </button>
            </div>
            {otpSent && !phoneVerified && (
              <div className="mt-2 flex gap-2">
                <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="인증번호 6자리" inputMode="numeric" />
                <button type="button" onClick={confirmOtp} disabled={otpLoading} className="flex-shrink-0 rounded-xl bg-slate-950 px-4 text-xs font-black text-white active:scale-95 disabled:opacity-50">확인</button>
              </div>
            )}
            {phoneVerified && <p className="mt-2 flex items-center gap-1 text-xs font-black text-emerald-600"><Check className="h-4 w-4" /> 인증 완료</p>}
          </div>

          {/* 2. 기본 정보 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">2. 기본 정보</p>
            <input className={`${inputCls} mb-2`} value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
            <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호 (8자 이상)" />
          </div>

          {/* 3. 직종 & 자격 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-1 text-xs font-black uppercase tracking-wide text-slate-500">3. 직종 &amp; 자격 증명 <span className="font-bold text-slate-300">(선택)</span></p>
            <p className="mb-3 rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] font-semibold leading-relaxed text-slate-500">
              💡 지금 자격을 등록해두면 공고 신청 시 <b className="text-sky-600">추가 입력 없이 바로 지원</b>할 수 있어요.<br />
              건너뛰어도 괜찮아요 — 나중에 공고에 신청할 때 해당 직종 자격 입력을 요청할 수 있어요. (운영자 검증 후 활성화)
            </p>
            <div className="space-y-2.5">
              {PROFS.map((p) => {
                const st = profs[p.value];
                return (
                  <div key={p.value} className={`rounded-xl border p-3 transition ${st.checked ? "border-sky-300 bg-sky-50/50" : "border-slate-200"}`}>
                    <button type="button" onClick={() => setProf(p.value, { checked: !st.checked })} className="flex w-full items-center gap-2.5 text-left">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${st.checked ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>
                        {st.checked && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="text-sm font-black text-slate-900">{p.label}</span>
                    </button>
                    {st.checked && (
                      <div className="mt-2.5 space-y-2 pl-7">
                        <input className={inputCls} value={st.certNumber} onChange={(e) => setProf(p.value, { certNumber: e.target.value })} placeholder={p.certHint} />
                        <input className={inputCls} value={st.experienceYears} onChange={(e) => setProf(p.value, { experienceYears: e.target.value.replace(/\D/g, "") })} placeholder="경력 (년)" inputMode="numeric" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 4. 약관 */}
          <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <p className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">4. 약관 동의</p>
            {[
              { v: terms, set: setTerms, label: "(필수) 서비스 이용약관" },
              { v: privacy, set: setPrivacy, label: "(필수) 개인정보 수집·이용" },
              { v: location, set: setLocation, label: "(선택) 위치정보 이용" },
            ].map((c, i) => (
              <button key={i} type="button" onClick={() => c.set(!c.v)} className="flex w-full items-center gap-2.5 py-1.5 text-left">
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${c.v ? "border-sky-500 bg-sky-500 text-white" : "border-slate-300"}`}>{c.v && <Check className="h-3.5 w-3.5" />}</span>
                <span className="text-sm font-semibold text-slate-700">{c.label}</span>
              </button>
            ))}
          </div>

          {error && <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-semibold text-rose-600">{error}</p>}
        </div>

        {/* 제출 */}
        <div className="fixed bottom-0 left-1/2 z-20 w-full max-w-md -translate-x-1/2 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
          <button onClick={submit} disabled={submitting} className="min-h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white active:scale-[0.98] disabled:opacity-50">
            {submitting ? "가입 중…" : "가입하고 시작하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
