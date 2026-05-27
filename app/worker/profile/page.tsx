"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock, Phone, User } from "lucide-react";

const INPUT_CLS = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100 disabled:opacity-60";

export default function WorkerProfilePage() {
  const router = useRouter();

  const [userName,        setUserName]        = useState("");
  const [phoneNumber,     setPhoneNumber]     = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isTemp,   setIsTemp]   = useState(false);

  useEffect(() => {
    fetch("/api/worker/profile")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setUserName(d.user.userName);
          setPhoneNumber(d.user.phoneNumber);
          setIsTemp(d.user.isTemporary ?? false);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (newPassword && newPassword !== confirmPassword) {
      setMsg({ type: "err", text: "새 비밀번호가 일치하지 않습니다." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/worker/profile", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          userName:        userName.trim() || undefined,
          phoneNumber:     phoneNumber || undefined,
          currentPassword: currentPassword || undefined,
          newPassword:     newPassword     || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setMsg({ type: "err", text: data.message });
        return;
      }
      setMsg({ type: "ok", text: "저장되었습니다." });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsTemp(false);
    } catch {
      setMsg({ type: "err", text: "저장 중 오류가 발생했습니다." });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900" />
      </div>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-5 pb-10 pt-safe-top">
      <div className="mx-auto max-w-md">
        {/* 헤더 */}
        <div className="flex items-center gap-3 pb-6 pt-4">
          <button onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-black text-slate-900">내 정보 수정</h1>
        </div>

        {isTemp && (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            임시 비밀번호로 로그인 중입니다. 비밀번호를 변경해주세요.
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          {/* 이름 */}
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700">
              <User className="h-3.5 w-3.5 text-slate-400" />
              이름
            </label>
            <input type="text" value={userName}
              onChange={e => setUserName(e.target.value)}
              className={INPUT_CLS} />
          </div>

          {/* 전화번호 */}
          <div>
            <label className="mb-2 flex items-center gap-1.5 text-sm font-black text-slate-700">
              <Phone className="h-3.5 w-3.5 text-slate-400" />
              전화번호
            </label>
            <input type="tel" value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              placeholder="010-1234-5678"
              inputMode="numeric"
              className={INPUT_CLS} />
          </div>

          {/* 비밀번호 변경 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
            <p className="flex items-center gap-1.5 text-sm font-black text-slate-700">
              <Lock className="h-3.5 w-3.5 text-slate-400" />
              비밀번호 변경
            </p>
            <input type="password" value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="현재 비밀번호" autoComplete="current-password"
              className={INPUT_CLS} />
            <input type="password" value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="새 비밀번호 (6자 이상)" autoComplete="new-password"
              className={INPUT_CLS} />
            <input type="password" value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="새 비밀번호 확인" autoComplete="new-password"
              className={INPUT_CLS} />
          </div>

          {msg && (
            <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${
              msg.type === "ok"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-rose-200 bg-rose-50 text-rose-700"
            }`}>
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 text-base font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97] disabled:opacity-70">
            {saving ? "저장 중..." : "저장"}
          </button>
        </form>
      </div>
    </main>
  );
}
