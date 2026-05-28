// next.config.ts
import type { NextConfig } from "next";

const securityHeaders = [
  // XSS 방어: 브라우저가 MIME sniffing 금지
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Clickjacking 방어: 동일 출처에서만 iframe 허용
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // HTTPS 강제 (2년, 서브도메인 포함)
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Referer 정보 최소화 (외부 링크로 전송 시 출처만)
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 불필요한 브라우저 기능 비활성화
  // microphone=(self): 동일 출처에서만 마이크 허용 (AI 일지 음성 녹음용)
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), interest-cohort=()" },
  // DNS 프리패치 허용
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  // ✅ pdfkit이 Turbopack 번들 경로(C:\#ROOT#\...)를 타지 않도록
  //    서버 번들에서 제외하고 런타임에 node_modules에서 로드하게 함
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

export default nextConfig;
