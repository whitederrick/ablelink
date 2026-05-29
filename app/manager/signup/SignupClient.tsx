"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, FileText, Lock, Phone, Upload, User } from "lucide-react";

type Step = "form" | "success";

export default function SignupClient() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("form");
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedLoginId, setSubmittedLoginId] = useState("");

  const [agencyName, setAgencyName] = useState("");
  const [bizType, setBizType] = useState<"BUSINESS" | "NON_PROFIT">("BUSINESS");
  const [businessNumber, setBusinessNumber] = useState("");
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  function formatBno(raw: string) {
    const d = raw.replace(/\D/g, "").slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/business-doc", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.message || "파일 업로드에 실패했습니다."); return; }
      setDocumentUrl(data.url);
      setDocumentName(file.name);
    } catch {
      setError("파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rawBno = businessNumber.replace(/-/g, "");
    if (!agencyName.trim()) { setError("기관명을 입력해주세요."); return; }
    if (!/^\d{10}$/.test(rawBno)) { setError("사업자번호/고유번호는 10자리 숫자여야 합니다."); return; }
    if (loginId.length < 4) { setError("아이디는 4자 이상이어야 합니다."); return; }
    if (password.length < 8) { setError("비밀번호는 8자 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/manager/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyName:          agencyName.trim(),
          businessNumber:      rawBno,
          businessNumberType:  bizType,
          loginId:             loginId.trim(),
          password,
          displayName:         displayName.trim() || null,
          phoneNumber:         phoneNumber.trim() || null,
          documentUrl:         documentUrl || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.message || "가입 신청에 실패했습니다."); return; }
      setSubmittedLoginId(loginId.trim());
      setStep("success");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const inp = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";
  const lbl = "mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700";
  const sec = "pt-2 text-xs font-black uppercase tracking-widest text-slate-400";

  if (step === "success") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-8">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-sky-500 shadow-lg shadow-sky-500/20">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-950">신청 완료</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            가입 신청이 접수되었습니다.<br />운영자 검토 후 연락드립니다.
          </p>
          <button
            onClick={() => router.push(`/manager/signup/status?loginId=${encodeURIComponent(submittedLoginId)}`)}
            className="mt-8 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97]">
            <span>신청 상태 확인</span><ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => router.push("/manager/login")}
            className="mt-3 w-full rounded-2xl px-5 py-3 text-sm font-bold text-slate-500 transition hover:text-slate-700">
            로그인 페이지로
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-50 px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-950 shadow-lg shadow-slate-950/20">
            <Building2 className="h-8 w-8 text-sky-400" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">AbleLink</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">에이전시 관리자 가입 신청</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <p className={sec}>기관 정보</p>

          <div>
            <label className={lbl}><Building2 className="h-3.5 w-3.5 text-slate-400" />기관명</label>
            <input value={agencyName} onChange={e => setAgencyName(e.target.value)}
              placeholder="기관명을 입력하세요" className={inp} />
          </div>

          <div>
            <label className={lbl}><FileText className="h-3.5 w-3.5 text-slate-400" />사업자 유형</label>
            <div className="flex gap-2">
              {(["BUSINESS", "NON_PROFIT"] as const).map(t => (
                <button key={t} type="button" onClick={() => setBizType(t)}
                  className={`flex-1 rounded-2xl border px-4 py-3 text-sm font-bold transition ${bizType === t ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-white"}`}>
                  {t === "BUSINESS" ? "사업자등록번호" : "고유번호"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={lbl}><FileText className="h-3.5 w-3.5 text-slate-400" />
              {bizType === "BUSINESS" ? "사업자등록번호" : "고유번호"}
            </label>
            <input value={businessNumber} onChange={e => setBusinessNumber(formatBno(e.target.value))}
              placeholder="000-00-00000" className={inp} />
          </div>

          <div>
            <label className={lbl}>
              <Upload className="h-3.5 w-3.5 text-slate-400" />
              {bizType === "BUSINESS" ? "사업자등록증" : "고유번호증"}
              <span className="font-semibold text-slate-400">(선택)</span>
            </label>
            <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={handleFile} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className={`w-full rounded-2xl border border-dashed px-4 py-3.5 text-sm font-semibold transition disabled:opacity-50 ${documentName ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-300 bg-slate-50 text-slate-400 hover:bg-white"}`}>
              {uploading ? "업로드 중..." : documentName ? `✓ ${documentName}` : "파일 선택 (JPG, PNG, PDF · 10MB 이하)"}
            </button>
          </div>

          <p className={sec}>계정 정보</p>

          <div>
            <label className={lbl}>
              <User className="h-3.5 w-3.5 text-slate-400" />담당자명
              <span className="font-semibold text-slate-400">(선택)</span>
            </label>
            <input value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="홍길동" className={inp} />
          </div>

          <div>
            <label className={lbl}>
              <Phone className="h-3.5 w-3.5 text-slate-400" />전화번호
              <span className="font-semibold text-slate-400">(선택)</span>
            </label>
            <input value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)}
              placeholder="010-0000-0000" type="tel" className={inp} />
          </div>

          <div>
            <label className={lbl}><User className="h-3.5 w-3.5 text-slate-400" />아이디</label>
            <input value={loginId} onChange={e => setLoginId(e.target.value)}
              placeholder="4자 이상 입력" autoComplete="username" className={inp} />
          </div>

          <div>
            <label className={lbl}><Lock className="h-3.5 w-3.5 text-slate-400" />비밀번호</label>
            <input value={password} onChange={e => setPassword(e.target.value)}
              placeholder="8자 이상 입력" type="password" autoComplete="new-password" className={inp} />
          </div>

          <div>
            <label className={lbl}><Lock className="h-3.5 w-3.5 text-slate-400" />비밀번호 확인</label>
            <input value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
              placeholder="비밀번호를 다시 입력하세요" type="password" autoComplete="new-password" className={inp} />
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || uploading}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70">
            {loading ? "신청 중..." : "가입 신청"}
          </button>

          <button type="button" onClick={() => router.push("/manager/login")}
            className="w-full rounded-2xl px-5 py-3 text-sm font-bold text-slate-500 transition hover:text-slate-700">
            이미 계정이 있으신가요? 로그인
          </button>
        </form>
      </div>
    </main>
  );
}
