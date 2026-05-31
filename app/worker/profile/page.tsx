"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BadgeCheck, ChevronRight, Lock, Mail, Phone, User } from "lucide-react";

const INPUT_CLS = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-base font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100 disabled:opacity-60";

type EmailStep = "idle" | "sent";

export default function WorkerProfilePage() {
  const router = useRouter();

  const [workerName,        setUserName]        = useState("");
  const [phoneNumber,     setPhoneNumber]     = useState("");
  const [loginId,         setLoginId]         = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword,     setNewPassword]     = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [isTemp,   setIsTemp]   = useState(false);

  // 이메일 아이디 변경
  const [emailStep,    setEmailStep]    = useState<EmailStep>("idle");
  const [newEmail,     setNewEmail]     = useState("");
  const [verifyCode,   setVerifyCode]   = useState("");
  const [sendingCode,  setSendingCode]  = useState(false);
  const [confirming,   setConfirming]   = useState(false);
  const [emailMsg,     setEmailMsg]     = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // 회원 탈퇴
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword,    setDeletePassword]    = useState("");
  const [deleting,          setDeleting]          = useState(false);
  const [deleteMsg,         setDeleteMsg]         = useState("");

  const isEmailLoginId = loginId.includes("@");

  useEffect(() => {
    fetch("/api/worker/profile")
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setUserName(d.user.workerName);
          setPhoneNumber(d.user.phoneNumber);
          setLoginId(d.user.loginId ?? "");
          setIsTemp(d.user.isTemporary ?? false);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete() {
    setDeleteMsg("");
    if (!deletePassword) { setDeleteMsg("비밀번호를 입력해주세요."); return; }
    setDeleting(true);
    try {
      const res = await fetch("/api/worker/profile/delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!data.success) { setDeleteMsg(data.message); return; }
      router.replace("/worker/login");
    } catch {
      setDeleteMsg("오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setDeleting(false);
    }
  }

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
          workerName:        workerName.trim() || undefined,
          phoneNumber:     phoneNumber || undefined,
          currentPassword: currentPassword || undefined,
          newPassword:     newPassword     || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) { setMsg({ type: "err", text: data.message }); return; }
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

  async function handleSendCode() {
    setEmailMsg(null);
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      setEmailMsg({ type: "err", text: "올바른 이메일 주소를 입력해주세요." });
      return;
    }
    setSendingCode(true);
    try {
      const res = await fetch("/api/worker/profile/email-change/request", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: newEmail }),
      });
      const d = await res.json();
      if (!d.success) { setEmailMsg({ type: "err", text: d.message }); return; }
      setEmailStep("sent");
      setEmailMsg({ type: "ok", text: d.message });
    } catch {
      setEmailMsg({ type: "err", text: "발송에 실패했습니다. 잠시 후 다시 시도해주세요." });
    } finally {
      setSendingCode(false);
    }
  }

  async function handleConfirmCode() {
    setEmailMsg(null);
    if (!verifyCode.trim()) {
      setEmailMsg({ type: "err", text: "인증 코드를 입력해주세요." });
      return;
    }
    setConfirming(true);
    try {
      const res = await fetch("/api/worker/profile/email-change/confirm", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code: verifyCode.trim() }),
      });
      const d = await res.json();
      if (!d.success) { setEmailMsg({ type: "err", text: d.message }); return; }
      setLoginId(d.newLoginId);
      setEmailStep("idle");
      setNewEmail("");
      setVerifyCode("");
      setEmailMsg({ type: "ok", text: `아이디가 ${d.newLoginId}(으)로 변경되었습니다.` });
    } catch {
      setEmailMsg({ type: "err", text: "확인에 실패했습니다. 잠시 후 다시 시도해주세요." });
    } finally {
      setConfirming(false);
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
            <input type="text" value={workerName}
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

          {/* 보유 자격 관리 */}
          <button
            type="button"
            onClick={() => router.push("/worker/profile/professions")}
            className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition active:scale-[0.99]"
          >
            <BadgeCheck className="h-5 w-5 flex-shrink-0 text-sky-500" />
            <div className="flex-1">
              <p className="text-sm font-black text-slate-800">보유 자격 관리</p>
              <p className="text-xs font-semibold text-slate-400">직무지도원·요양보호사·활동지원사 자격 등록·증명</p>
            </div>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
          </button>

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
              placeholder="새 비밀번호 (8자 이상)" autoComplete="new-password"
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

        {/* 아이디(로그인) 변경 */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-black text-slate-700">
              <Mail className="h-3.5 w-3.5 text-slate-400" />
              로그인 아이디 변경
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              현재 아이디: <span className="text-slate-600">{loginId}</span>
              {isEmailLoginId
                ? <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-sky-600">이메일</span>
                : <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">전화번호</span>}
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              전화번호 대신 이메일 주소로 로그인하려면 아래에서 변경할 수 있습니다.
            </p>
          </div>

          {emailStep === "idle" ? (
            <div className="flex gap-2">
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="변경할 이메일 주소"
                autoComplete="email"
                className={INPUT_CLS}
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={sendingCode}
                className="shrink-0 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition active:scale-95 disabled:opacity-60"
              >
                {sendingCode ? "발송 중..." : "코드 발송"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500">
                <span className="font-black text-slate-700">{newEmail}</span>으로 인증 코드를 발송했습니다.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={verifyCode}
                  onChange={e => setVerifyCode(e.target.value)}
                  placeholder="인증 코드 6자리"
                  inputMode="numeric"
                  maxLength={6}
                  className={INPUT_CLS}
                />
                <button
                  type="button"
                  onClick={handleConfirmCode}
                  disabled={confirming}
                  className="shrink-0 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white transition active:scale-95 disabled:opacity-60"
                >
                  {confirming ? "확인 중..." : "확인"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setEmailStep("idle"); setVerifyCode(""); setEmailMsg(null); }}
                className="text-xs font-semibold text-slate-400 underline"
              >
                다른 이메일로 다시 시도
              </button>
            </div>
          )}

          {emailMsg && (
            <div className={`rounded-2xl px-4 py-3 text-sm font-bold ${
              emailMsg.type === "ok"
                ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border border-rose-200 bg-rose-50 text-rose-700"
            }`}>
              {emailMsg.text}
            </div>
          )}
        </div>

        {/* 회원 탈퇴 */}
        <div className="mt-8 mb-10">
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-3 text-center text-sm font-semibold text-slate-400 transition hover:text-rose-500"
            >
              회원 탈퇴
            </button>
          ) : (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 space-y-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-5 w-5 flex-shrink-0 text-rose-500 mt-0.5" />
                <div>
                  <p className="text-sm font-black text-rose-800">정말 탈퇴하시겠습니까?</p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-rose-600">
                    탈퇴 시 이름·전화번호·서명 등 개인정보가 즉시 삭제됩니다.<br />
                    출퇴근·업무일지 기록은 소속 에이전시 운영 기록으로 보존됩니다.
                  </p>
                </div>
              </div>
              <input
                type="password"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeleteMsg(""); }}
                placeholder="현재 비밀번호 입력"
                className="w-full rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-rose-400 focus:ring-4 focus:ring-rose-100"
              />
              {deleteMsg && (
                <p className="text-xs font-semibold text-rose-700">{deleteMsg}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowDeleteConfirm(false); setDeletePassword(""); setDeleteMsg(""); }}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  취소
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting || !deletePassword}
                  className="flex-1 rounded-xl bg-rose-600 py-2.5 text-sm font-black text-white transition active:scale-95 disabled:opacity-50"
                >
                  {deleting ? "처리 중..." : "탈퇴 확인"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
