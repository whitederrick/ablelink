"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { XCircle } from "lucide-react";

function FailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const message = params.get("message") || "결제가 취소되었거나 실패했습니다.";

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-6 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl shadow-slate-950/10">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-50">
          <XCircle className="h-8 w-8 text-rose-500" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-black text-slate-900">결제 실패</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">{message}</p>
        <div className="mt-6 space-y-2">
          <button
            onClick={() => router.back()}
            className="min-h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97]"
          >
            다시 시도
          </button>
          <button
            onClick={() => router.replace("/worker/home")}
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 text-sm font-black text-slate-600 transition active:scale-[0.97]"
          >
            홈으로
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FailPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-slate-50" />}>
      <FailContent />
    </Suspense>
  );
}
