// app/worker/layout.tsx
// 직무지도원 웹 레이아웃 - 모바일 최적화 + PWA 지원

import type { Metadata, Viewport } from "next";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";

export const metadata: Metadata = {
  title: "AbleLink - 직무지도원",
  description: "장애인 직무지도 지원 서비스",
  manifest: "/worker-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AbleLink",
    startupImage: "/icons/icon-512.png",
  },
  icons: {
    apple: [
      { url: "/icons/icon-192.png", sizes: "192x192" },
      { url: "/icons/icon-512.png", sizes: "512x512" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#111827",
};

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        body { margin: 0; padding: 0; background: #f7f8fa; }
        button { font-family: inherit; }
        input { font-family: inherit; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
      {children}
      <PWAInstallPrompt />
    </div>
  );
}
