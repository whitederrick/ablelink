"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Link2, CheckCircle2 } from "lucide-react";

const INPUT_CLS =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-center text-2xl font-black tracking-[0.3em] text-slate-900 outline-none transition placeholder:tracking-normal placeholder:text-base placeholder:font-semibold placeholder:text-slate-400 focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100 disabled:opacity-60";

export default function WorkerConnectPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<{ siteName: string | null } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    const c = code.trim();
    if (!c) { setMsg("인증코드를 입력해주세요."); return; }
    setLoading(true); setMsg(null);
    try {
      const res = await fetch("/api/worker/assignment/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });
      const data = await res.json();
      if (!data.success) { setMsg(data.message || "연결에 실패했습니다."); return; }
      setDone({ siteName: data.siteName ?? null });
    } catch {
      setMsg("서버와 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white px-5 pb-16 pt-5">
      <button onClick={() => router.push("/worker/home")} className="mb-4 flex items-center gap-1 text-sm font-bold text-slate-400">
        <ArrowLeft className="h-4 w-4" /> 홈으로
      </button>

      {done ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
          </div>
          <h1 className="mt-5 text-xl font-black text-slate-900">배정이 연결되었습니다</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            {done.siteName ? `${done.siteName} 배정이 연결되었어요.` : "새 현장 배정이 연결되었어요."}
            <br />현장에 처음 방문해 위치를 확정하면 출근할 수 있어요.
          </p>
          <button onClick={() => router.push("/worker/home")} className="mt-8 w-full rounded-2xl bg-slate-900 py-4 text-base font-black text-white">
            홈으로 이동
          </button>
        </div>
      ) : (
        <>
          <div className="mb-6 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50">
              <Link2 className="h-5 w-5 text-sky-500" />
            </div>
            <div>
              <h1 className="text-lg font-black text-slate-900">배정 연결</h1>
              <p className="text-xs font-semibold text-slate-400">담당자가 보낸 인증코드를 입력하세요.</p>
            </div>
          </div>

          <input
            inputMode="numeric"
            autoFocus
            value={code}
            onChange={(e) => { setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6)); setMsg(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            placeholder="인증코드 6자리"
            className={INPUT_CLS}
          />

          {msg && <p className="mt-3 text-center text-sm font-bold text-rose-600">{msg}</p>}

          <button
            onClick={submit}
            disabled={loading || code.length === 0}
            className="mt-6 w-full rounded-2xl bg-slate-900 py-4 text-base font-black text-white disabled:opacity-50"
          >
            {loading ? "연결 중..." : "배정 연결하기"}
          </button>

          <p className="mt-4 text-center text-xs font-semibold text-slate-400">
            인증코드는 근로계약 완료 시 알림톡으로 전송됩니다.<br />코드가 없거나 만료된 경우 담당자에게 문의하세요.
          </p>
        </>
      )}
    </div>
  );
}
