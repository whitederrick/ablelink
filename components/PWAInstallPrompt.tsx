"use client";

import { useEffect, useState } from "react";

export default function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowBanner(false);
  }

  if (!showBanner) return null;

  return (
    <div style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      backgroundColor: "#161C2A", border: "1px solid #222C41",
      padding: "16px 20px", borderRadius: 16,
      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
      zIndex: 9999, width: "90%", maxWidth: 400,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
    }}>
      <p style={{ color: "#fff", fontSize: 14, margin: 0, textAlign: "center", lineHeight: 1.6 }}>
        <strong>ableLink</strong>를 홈 화면에 추가하면<br />
        주소창 없는 앱 모드로 편리하게 이용할 수 있습니다.
      </p>
      <div style={{ display: "flex", gap: 8, width: "100%" }}>
        <button
          onClick={() => setShowBanner(false)}
          style={{ flex: 1, padding: "10px", backgroundColor: "#222C41", color: "#A0AEC0", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}
        >다음에</button>
        <button
          onClick={handleInstall}
          style={{ flex: 2, padding: "10px", background: "linear-gradient(90deg, #38BDF8, #10B981)", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer" }}
        >앱 설치하기</button>
      </div>
    </div>
  );
}
