"use client";

import { useEffect, useState } from "react";

// 구버전 브라우저 안내. Tailwind v4의 color-mix(투명도 등)는 구버전(Chrome/Edge <111,
// Safari <16.4)에서 미동작해 화면이 일부 깨질 수 있음 → 그런 브라우저에만 업데이트 권유.
// ⚠️ Tailwind가 깨지는 환경이므로 인라인 스타일로만 작성(클래스 의존 X).
export default function OldBrowserNotice() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const supported =
        typeof CSS !== "undefined" &&
        typeof CSS.supports === "function" &&
        CSS.supports("color", "color-mix(in oklab, red, red)");
      if (!supported && sessionStorage.getItem("ablelink_oldbrowser_dismiss") !== "1") {
        setShow(true);
      }
    } catch { /* CSS API 없음 = 매우 구버전 → 노출 */ setShow(true); }
  }, []);

  if (!show) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 2147483647,
        background: "#b45309", color: "#ffffff",
        padding: "12px 16px", fontSize: "13px", fontWeight: 700, lineHeight: 1.5,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px",
        boxShadow: "0 -2px 8px rgba(0,0,0,0.2)",
      }}
    >
      <span>
        사용 중인 브라우저가 오래되어 화면이 일부 깨질 수 있습니다. Chrome 또는 Edge 최신 버전으로 업데이트해 주세요.
      </span>
      <button
        type="button"
        onClick={() => { try { sessionStorage.setItem("ablelink_oldbrowser_dismiss", "1"); } catch {} setShow(false); }}
        style={{
          flexShrink: 0, background: "#ffffff", color: "#b45309",
          border: "none", borderRadius: "8px", padding: "6px 12px",
          fontSize: "13px", fontWeight: 800, cursor: "pointer",
        }}
      >
        닫기
      </button>
    </div>
  );
}
