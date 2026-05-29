"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Lock, Phone, User } from "lucide-react";

type InviteInfo = { agencyName: string; email: string | null; expiresAt: string };

export default function InviteClient({ code }: { code: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [invalid, setInvalid] = useState(false);

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/manager/invite/${code}`);
        const data = await res.json();
        if (!res.ok || !data.success) { setInvalid(true); setError(data.message || "유효하지 않은 초대 코드입니다."); return; }
        setInvite(data);
      } catch {
        setInvalid(true);
        setError("초대 정보를 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [code]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loginId.length < 4) { setError("아이디는 4자 이상이어야 합니다."); return; }
    if (password.length < 8) { setError("비밀번호는 8자 이상이어야 합니다."); return; }
    if (password !== passwordConfirm) { setError("비밀번호가 일치하지 않습니다."); return; }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/manager/invite/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loginId:     loginId.trim(),
          password,
          displayName: displayName.trim() || null,
          phoneNumber: phoneNumber.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.message || "계정 생성에 실패했습니다."); return; }
      router.replace("/manager");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const inp = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";
  const lbl = "mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[2.5px] border-slate-200 border-t-sky-500" />
          <p className="mt-3 text-sm font-semibold text-slate-400">초대 정보 확인 중...</p>
        </div>
      </div>
    );
  }

  if (invalid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-8">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-100">
            <Building2 className="h-8 w-8 text-rose-400" />
          </div>
          <h1 className="text-xl font-black text-slate-950">유효하지 않은 초대</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">{error}</p>
          <button onClick={() => router.push("/manager/login")}
            className="mt-8 flex min-h-14 w-full items-center justify-center rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97]">
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
          <p className="mt-1 text-sm font-semibold text-slate-500">에이전시 관리자 초대 가입</p>
        </div>

        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
          <p className="text-sm font-black text-sky-800">{invite!.agencyName}</p>
          <p className="mt-0.5 text-xs font-semibold text-sky-600">에서 초대되었습니다.</p>
          <p className="mt-1 text-xs text-sky-500">
            만료일: {new Date(invite!.expiresAt).toLocaleDateString("ko-KR")}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
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

          <button type="submit" disabled={submitting}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70">
            {submitting ? "계정 생성 중..." : <><span>계정 생성</span><ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>
      </div>
    </main>
  );
}
