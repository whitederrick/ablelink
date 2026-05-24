"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

function SuccessContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const authKey = params.get("authKey");
    const planType = params.get("planType");
    const agencyId = params.get("agencyId");
    const customerKey = params.get("customerKey");

    if (!authKey || !planType || !agencyId || !customerKey) {
      setStatus("error");
      setMessage("결제 정보가 올바르지 않습니다.");
      return;
    }

    fetch("/api/payments/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authKey, planType, agencyId, customerKey }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setStatus("success");
          setMessage(`다음 결제일: ${new Date(data.nextBillingAt).toLocaleDateString("ko-KR")}`);
          setTimeout(() => router.replace("/worker/home"), 2500);
        } else {
          setStatus("error");
          setMessage(data.message || "결제 처리에 실패했습니다.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("서버 오류가 발생했습니다.");
      });
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-slate-50 px-6 py-10">
      {status === "loading" && (
        <>
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-slate-200 border-t-slate-950" />
          <p className="text-sm font-semibold text-slate-500">결제 처리 중입니다...</p>
        </>
      )}

      {status === "success" && (
        <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl shadow-slate-950/10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-50">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-black text-slate-900">구독 완료!</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500 whitespace-pre-line">{message}</p>
          <p className="mt-3 text-xs font-semibold text-slate-400">잠시 후 홈으로 이동합니다.</p>
        </div>
      )}

      {status === "error" && (
        <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 text-center shadow-xl shadow-slate-950/10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-50">
            <XCircle className="h-8 w-8 text-rose-500" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-black text-slate-900">결제 실패</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">{message}</p>
          <button
            onClick={() => router.back()}
            className="mt-6 min-h-12 w-full rounded-2xl bg-slate-950 text-sm font-black text-white shadow-lg shadow-slate-950/20 transition active:scale-[0.97]"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-dvh items-center justify-center bg-slate-50 text-sm font-semibold text-slate-400">
        로딩 중...
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
