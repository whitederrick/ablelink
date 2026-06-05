"use client";

// 스마트폰 본인 서명 페이지 (공개 — 토큰 인증). PC에서 QR/링크로 진입.
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, PenLine } from "lucide-react";
import { SignaturePad, type SignaturePadHandle } from "../../_components/SignaturePad";

export default function SelfSignPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token as string;
  const padRef = useRef<SignaturePadHandle>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "expired" | "done">("loading");
  const [name, setName] = useState<string | null>(null);
  const [empty, setEmpty] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/sign-self/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) { setName(d.name); setPhase("ready"); }
        else setPhase("expired");
      })
      .catch(() => setPhase("expired"));
  }, [token]);

  async function submit() {
    setErr("");
    const blob = await padRef.current?.getBlob();
    if (!blob) { setErr("서명을 입력해주세요."); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("signature", blob, "signature.png");
      const res = await fetch(`/api/sign-self/${token}`, { method: "POST", body: fd });
      const d = await res.json();
      if (!d.success) { setErr(d.message || "저장 실패"); return; }
      setPhase("done");
    } catch {
      setErr("서버와 연결할 수 없습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (phase === "loading") {
    return <div className="flex min-h-dvh items-center justify-center bg-slate-50">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-900" />
    </div>;
  }

  if (phase === "expired") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-100">
          <PenLine className="h-8 w-8 text-rose-400" />
        </div>
        <p className="text-lg font-black text-slate-900">링크가 만료되었습니다</p>
        <p className="text-sm font-semibold text-slate-400">PC 화면에서 "스마트폰으로 서명"을 다시 눌러 새 QR을 받아주세요.</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-100">
          <CheckCircle2 className="h-9 w-9 text-emerald-500" />
        </div>
        <p className="text-lg font-black text-emerald-600">서명이 저장되었습니다</p>
        <p className="text-sm font-semibold text-slate-400">PC 화면에 자동으로 반영됩니다. 이 창은 닫으셔도 됩니다.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="mb-4 text-center">
          <h1 className="text-xl font-black text-slate-900">서명 입력</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400">
            {name ? `${name}님` : "관리자"} · 화면 칸에 손가락으로 서명해주세요
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border-2 border-slate-950 bg-white">
          <SignaturePad ref={padRef} height={300} onChange={setEmpty} />
        </div>

        {err && <p className="mt-2 text-center text-sm font-bold text-rose-600">{err}</p>}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => padRef.current?.clear()}
            className="min-h-13 flex-1 rounded-2xl bg-slate-100 py-3.5 text-base font-black text-slate-700 transition active:scale-[0.97]"
          >
            지우기
          </button>
          <button
            onClick={submit}
            disabled={saving || empty}
            className="min-h-13 flex-[2] rounded-2xl bg-slate-950 py-3.5 text-base font-black text-white transition active:scale-[0.97] disabled:opacity-50"
          >
            {saving ? "저장 중..." : "서명 제출"}
          </button>
        </div>

        <p className="mt-4 text-center text-xs font-semibold text-slate-400">
          제출하면 PC에서 작성 중인 문서의 관리자 서명으로 저장됩니다.
        </p>
      </div>
    </div>
  );
}
