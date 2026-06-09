"use client";

import { useEffect } from "react";

// 워커 앱을 열 때마다 세션을 90일로 재발급(롤링) → 정기 사용자는 재로그인 거의 없음.
// 실패(미로그인/비활성)해도 무시: 페이지 가드/각 API가 별도로 인증을 처리한다.
export default function SessionRefresh() {
  useEffect(() => {
    fetch("/api/worker/auth/refresh", { method: "POST", cache: "no-store" }).catch(() => {});
  }, []);
  return null;
}
