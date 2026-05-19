// app/admin/shell/components/AdminTopbar.tsx
// 관리자 상단바 컴포넌트
// 로그인 사용자 정보 표시 및 로그아웃 기능 제공
// 로그아웃 시 상위 shell state 초기화 및 로그인 화면으로 리다이렉트
// 클라이언트 컴포넌트로 구현

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type SessionInfo = {
  role: "ADMIN" | "GOV" | "AGENCY" | string;
  loginId: string;
  agencyName?: string | null;
};

export default function AdminTopbar({
  session,
  onLoggedOut,
}: {
  session?: SessionInfo;
  onLoggedOut: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    if (loading) return;
    setLoading(true);

    try {
      const res = await fetch("/api/admin/auth/logout", {
        method: "POST",
        cache: "no-store",
      });

      // 서버가 401/500 등을 반환해도, 쿠키가 이미 만료됐을 수 있으므로
      // UX 관점에서는 "로그아웃 처리"로 동일하게 종료시키는 것이 안전합니다.
      // 다만, 완전 실패(네트워크 오류)만 콘솔로 남깁니다.
      if (!res.ok) {
        // best-effort
        console.warn("Logout response not ok:", res.status);
      }
    } catch (e) {
      console.error("Logout failed:", e);
    } finally {
      setLoading(false);

      // 상위 shell state 초기화
      onLoggedOut();

      // 명시적으로 로그인 화면으로 이동 (상위 구현에 의존하지 않음)
      router.replace("/admin/login");
      router.refresh();
    }
  }

  return (
    <header
      style={{
        height: 56,
        background: "#fff",
        borderBottom: "1px solid #e5e7eb",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
      }}
    >
      <div style={{ fontSize: 13, color: "#374151" }}>
        {session?.loginId ? (
          <>
            <b>{session.role}</b> / {session.loginId}
            {session.agencyName ? <span> (기관: {session.agencyName})</span> : null}
          </>
        ) : (
          <span style={{ color: "#9ca3af" }}> </span>
        )}
      </div>

      <button
        onClick={logout}
        disabled={loading}
        style={{
          padding: "8px 12px",
          border: "1px solid #d1d5db",
          borderRadius: 8,
          background: "#fff",
          cursor: loading ? "not-allowed" : "pointer",
          fontSize: 13,
          opacity: loading ? 0.8 : 1,
        }}
        aria-busy={loading}
      >
        {loading ? "로그아웃 중..." : "로그아웃"}
      </button>
    </header>
  );
}
