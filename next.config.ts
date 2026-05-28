// next.config.ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): 동일 출처에서만 마이크 허용 (AI 일지 음성 녹음용)
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "playwright"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org:     process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // 소스맵 업로드 (에러 추적 정확도 향상)
  silent: true,
  widenClientFileUpload: true,
  // 터널 라우트: 광고 차단기 우회
  tunnelRoute: "/monitoring",
  // 빌드 시 Sentry DSN 미설정이어도 에러 없이 진행
  disableLogger: true,
});
