import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegistrar from "./_components/ServiceWorkerRegistrar";
import OldBrowserNotice from "./_components/OldBrowserNotice";
import { Analytics } from "@vercel/analytics/react";

export const metadata: Metadata = {
  title: "Able-Link",
  description: "장애인 직무지도원 관리 서비스",
};

// CSP nonce(요청별)는 빌드 시점에 박제되는 정적 프리렌더와 양립 불가 — 전 페이지 동적 렌더 강제.
// (2026-07-16 nonce 전환. 정적 프리렌더 페이지는 프레임워크 인라인 스크립트에 nonce가 없어 차단됨.)
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <ServiceWorkerRegistrar />
        {children}
        <OldBrowserNotice />
        <Analytics />
      </body>
    </html>
  );
}
