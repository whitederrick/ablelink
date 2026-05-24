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
  themeColor: "#0f172a",
};

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      {children}
      <PWAInstallPrompt />
    </div>
  );
}
