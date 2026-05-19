"use client";
// app/worker/subscribe/success/page.tsx
// 토스페이먼츠 빌링키 발급 성공 콜백 → 서버에서 결제 처리

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

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

    // 서버에서 빌링키 발급 + 결제 처리
    fetch("/api/payments/billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authKey, planType, agencyId, customerKey }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setStatus("success");
          setMessage(`구독이 시작되었습니다!\n다음 결제일: ${new Date(data.nextBillingAt).toLocaleDateString("ko-KR")}`);
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
    <div style={s.page}>
      {status === "loading" && (
        <>
          <div style={s.spinner} />
          <p style={s.text}>결제 처리 중입니다...</p>
        </>
      )}
      {status === "success" && (
        <>
          <span style={s.icon}>🎉</span>
          <p style={s.successText}>구독 완료!</p>
          <p style={s.text}>{message}</p>
          <p style={s.subText}>잠시 후 홈으로 이동합니다.</p>
        </>
      )}
      {status === "error" && (
        <>
          <span style={s.icon}>❌</span>
          <p style={s.errorText}>결제 실패</p>
          <p style={s.text}>{message}</p>
          <button style={s.btn} onClick={() => router.back()}>다시 시도</button>
        </>
      )}
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center" }}>로딩 중...</div>}>
      <SuccessContent />
    </Suspense>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "#f8f9ff" },
  spinner: { width: 44, height: 44, border: "4px solid #e0e5ff", borderTop: "4px solid #5865F2", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  icon: { fontSize: 56 },
  text: { fontSize: 15, color: "#555", textAlign: "center", whiteSpace: "pre-line", margin: 0 },
  subText: { fontSize: 13, color: "#aaa", margin: 0 },
  successText: { fontSize: 22, fontWeight: 800, color: "#2e7d32", margin: 0 },
  errorText: { fontSize: 22, fontWeight: 800, color: "#e53935", margin: 0 },
  btn: { padding: "14px 32px", backgroundColor: "#5865F2", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: "pointer" },
};
