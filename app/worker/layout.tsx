// app/worker/layout.tsx
// 직무지도원 웹 레이아웃 - 모바일 최적화 + PWA 지원

import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "AbleLink - 직무지도원",
  description: "장애인 직무지도 지원 서비스",
  manifest: "/worker-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AbleLink",
  },
  icons: {
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
    </div>
  );
}
