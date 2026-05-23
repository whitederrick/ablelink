"use client";

import { useEffect, useState } from "react";

type Mode = "android" | "ios" | null;

export default function PWAInstallPrompt() {
  const [mode, setMode] = useState<Mode>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 이미 standalone(설치됨) 상태면 표시 안 함
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (isStandalone) return;

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
      !/crios|fxios/i.test(navigator.userAgent); // Chrome/Firefox on iOS 제외

    if (isIOS) {
      const dismissed = sessionStorage.getItem("pwa-ios-dismissed");
      if (!dismissed) setMode("ios");
      return;
    }

    // Android Chrome — beforeinstallprompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  function dismiss() {
    sessionStorage.setItem("pwa-ios-dismissed", "1");
    setMode(null);
    setDismissed(true);
  }

  async function handleAndroidInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setMode(null);
  }

  if (!mode || dismissed) return null;

  return (
    <div style={{
      position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
      backgroundColor: "#1f2937", border: "1px solid #374151",
      padding: "16px 18px", borderRadius: 18,
      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      zIndex: 9999, width: "calc(100% - 32px)", maxWidth: 400,
    }}>
      <button
        onClick={dismiss}
        style={{ position: "absolute", top: 10, right: 12, background: "none", border: "none", color: "#9ca3af", fontSize: 18, cursor: "pointer", padding: 4 }}
        aria-label="닫기"
      >×</button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="AbleLink" style={{ width: 44, height: 44, borderRadius: 10 }} />
        <div>
          <p style={{ color: "#fff", fontSize: 14, fontWeight: 700, margin: 0 }}>AbleLink 앱 설치</p>
          <p style={{ color: "#9ca3af", fontSize: 12, margin: "2px 0 0" }}>홈 화면에서 바로 실행</p>
        </div>
      </div>

      {mode === "android" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={dismiss}
            style={{ flex: 1, padding: "10px", backgroundColor: "#374151", color: "#9ca3af", border: "none", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
          >다음에</button>
          <button
            onClick={handleAndroidInstall}
            style={{ flex: 2, padding: "10px", background: "linear-gradient(90deg, #3b82f6, #10b981)", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
          >홈 화면에 추가</button>
        </div>
      )}

      {mode === "ios" && (
        <div>
          <div style={{ background: "#111827", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
            <p style={{ color: "#d1d5db", fontSize: 13, margin: 0, lineHeight: 1.7 }}>
              1. 하단 <strong style={{ color: "#fff" }}>공유 버튼 (□↑)</strong> 탭<br />
              2. <strong style={{ color: "#fff" }}>홈 화면에 추가</strong> 선택<br />
              3. 오른쪽 상단 <strong style={{ color: "#fff" }}>추가</strong> 탭
            </p>
          </div>
          <p style={{ color: "#6b7280", fontSize: 11, margin: "0 0 10px", textAlign: "center" }}>
            설치 후 주소창 없이 앱처럼 사용할 수 있습니다
          </p>
          <button
            onClick={dismiss}
            style={{ width: "100%", padding: "10px", backgroundColor: "#374151", color: "#9ca3af", border: "none", borderRadius: 10, fontSize: 13, cursor: "pointer" }}
          >확인했어요</button>
        </div>
      )}
    </div>
  );
}
