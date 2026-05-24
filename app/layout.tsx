import type { Metadata } from "next";
import "./globals.css";
import ServiceWorkerRegistrar from "./_components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: "AbleLink",
  description: "장애인 직무지도원 관리 서비스",
};

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
      </body>
    </html>
  );
}
