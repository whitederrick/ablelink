"use client";
// app/worker/subscribe/fail/page.tsx

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function FailContent() {
  const router = useRouter();
  const params = useSearchParams();
  const message = params.get("message") || "결제가 취소되었거나 실패했습니다.";

  return (
    <div style={s.page}>
      <span style={s.icon}>😢</span>
      <p style={s.title}>결제 실패</p>
      <p style={s.desc}>{message}</p>
      <button style={s.btn} onClick={() => router.back()}>다시 시도</button>
      <button style={s.homeBtn} onClick={() => router.replace("/worker/home")}>홈으로</button>
    </div>
  );
}

export default function FailPage() {
  return (
    <Suspense fallback={<div />}>
      <FailContent />
    </Suspense>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, backgroundColor: "#f8f9ff" },
  icon: { fontSize: 56 },
  title: { fontSize: 22, fontWeight: 800, color: "#e53935", margin: 0 },
  desc: { fontSize: 14, color: "#666", textAlign: "center", margin: 0 },
  btn: { padding: "13px 32px", backgroundColor: "#5865F2", color: "#fff", border: "none", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer" },
  homeBtn: { padding: "13px 32px", backgroundColor: "#f0f0f0", color: "#555", border: "none", borderRadius: 12, fontSize: 15, cursor: "pointer" },
};
