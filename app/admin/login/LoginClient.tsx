"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Settings, User } from "lucide-react";

export default function LoginClient() {
  const router = useRouter();

  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setError(data?.message || "아이디 또는 비밀번호를 확인해주세요.");
        return;
      }
      if (data.role === "AGENCY") {
        router.replace("/manager");
      } else {
        router.replace("/admin");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-5 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500 shadow-lg shadow-emerald-500/30">
            <Settings className="h-8 w-8 text-white" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">AbleLink</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">시스템 운영자 로그인</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-300">
              <User className="h-3.5 w-3.5 text-slate-500" />아이디
            </label>
            <input value={loginId} onChange={e => setLoginId(e.target.value)}
              placeholder="아이디를 입력하세요" autoComplete="username"
              className="w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3.5 text-base font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20" />
          </div>
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-300">
              <Lock className="h-3.5 w-3.5 text-slate-500" />비밀번호
            </label>
            <input value={password} onChange={e => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요" type="password" autoComplete="current-password"
              className="w-full rounded-2xl border border-slate-700 bg-slate-800 px-4 py-3.5 text-base font-semibold text-white outline-none transition placeholder:text-slate-600 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20" />
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-800 bg-rose-950 px-4 py-3 text-sm font-bold text-rose-400">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-5 text-base font-black text-white shadow-lg shadow-emerald-500/30 transition active:scale-[0.97] disabled:opacity-70">
            {loading ? "로그인 중..." : <><span>로그인</span><ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-600">
          에이전시 관리자는{" "}
          <a href="/manager/login" className="text-slate-400 underline">여기서 로그인</a>
        </p>
      </div>
    </main>
  );
}
