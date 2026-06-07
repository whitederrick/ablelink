"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, User } from "lucide-react";

export default function WorkerLoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/worker/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.replace(/-/g, ""), password }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "로그인에 실패했습니다.");
        return;
      }
      router.replace("/worker/home"); // 셀프 현장등록 종료 — 현장 없어도 홈(배정 대기 안내)
    } catch {
      setError("서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <section className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-sm flex-col justify-between">
        {/* 로고 */}
        <div className="pt-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-950 shadow-lg shadow-slate-950/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="AbleLink" className="h-10 w-10 rounded-2xl" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950">AbleLink</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">장애인 직무지도 지원 서비스</p>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700">
              <User className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              아이디 (전화번호 또는 이메일)
            </label>
            <input
              type="text"
              placeholder="01012345678 또는 이메일"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700">
              <Lock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
              비밀번호
            </label>
            <input
              type="password"
              placeholder="비밀번호를 입력하세요"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70"
          >
            {loading ? "로그인 중..." : (
              <>
                로그인
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>

          <p className="text-center text-xs font-semibold text-slate-400">
            계정은 에이전시 초대 또는 운영자를 통해 발급됩니다.
          </p>

          <div className="flex items-center justify-center gap-2 text-sm">
            <span className="font-semibold text-slate-500">비밀번호를 잊으셨나요?</span>
            <Link href="/worker/reset-password" className="font-black text-slate-600">
              비밀번호 찾기
            </Link>
          </div>
        </form>

        {/* AI 배너 — 1줄 홍보 */}
        <p className="mb-4 rounded-3xl border border-sky-100 bg-sky-50 px-4 py-3 text-center text-xs font-semibold text-sky-700">
          AI 기반 음성 일지 작성, PDF 자동 생성 등의 서비스가 제공됩니다.
        </p>
      </section>
    </main>
  );
}
