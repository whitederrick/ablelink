"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";

const INPUT_CLS = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [mode,       setMode]       = useState<"phone" | "email">("phone");
  const [identifier, setIdentifier] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [done,       setDone]       = useState(false);
  const [doneMsg,    setDoneMsg]    = useState("");
  const [error,      setError]      = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/worker/auth/reset-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ identifier }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message); return; }
      setDoneMsg(data.message);
      setDone(true);
    } catch {
      setError("서버와 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  function switchMode(m: "phone" | "email") {
    setMode(m);
    setIdentifier("");
    setError("");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-sm">
        <div className="flex items-center gap-3 pb-8 pt-4">
          <button onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-black text-slate-950">비밀번호 찾기</h1>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-bold text-emerald-700">
              {doneMsg}<br />로그인 후 반드시 비밀번호를 변경해주세요.
            </div>
            <button onClick={() => router.push("/worker/login")}
              className="w-full rounded-2xl bg-slate-950 py-4 text-base font-black text-white">
              로그인 화면으로
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 방법 선택 탭 */}
            <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
              {[
                { key: "phone" as const, label: "전화번호", Icon: Phone },
                { key: "email" as const, label: "이메일",   Icon: Mail  },
              ].map(({ key, label, Icon }) => (
                <button key={key} type="button" onClick={() => switchMode(key)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-black transition ${
                    mode === key ? "bg-slate-950 text-white" : "text-slate-400 hover:text-slate-600"
                  }`}>
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            <p className="text-sm font-semibold text-slate-500">
              {mode === "phone"
                ? "가입 시 등록한 전화번호로 임시 비밀번호를 SMS 발송합니다."
                : "아이디로 사용 중인 이메일로 임시 비밀번호를 발송합니다."}
            </p>

            <div>
              <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700">
                {mode === "phone"
                  ? <><Phone className="h-3.5 w-3.5 text-slate-400" />전화번호</>
                  : <><Mail  className="h-3.5 w-3.5 text-slate-400" />이메일 주소</>}
              </label>
              {mode === "phone" ? (
                <input type="tel" value={identifier} onChange={e => setIdentifier(e.target.value)}
                  placeholder="01012345678" inputMode="numeric"
                  className={INPUT_CLS} required />
              ) : (
                <input type="email" value={identifier} onChange={e => setIdentifier(e.target.value)}
                  placeholder="example@email.com"
                  className={INPUT_CLS} required />
              )}
            </div>

            {error && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-slate-950 text-base font-black text-white shadow-lg disabled:opacity-70">
              {loading ? "처리 중..." : "임시 비밀번호 받기"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
