// next.config.ts
import type { NextConfig } from "next";

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

  // PDF 생성(pdfkit) 라우트의 서버리스 함수 번들에 한글 폰트 포함
  // (public/은 기본적으로 함수 fs에 포함되지 않아 fs.readFileSync 실패 방지)
  // renderPdfToBuffer를 호출하는 모든 라우트 그룹 커버: worker/docs, admin/docs, audit-package, document-versions
  outputFileTracingIncludes: {
    "/api/worker/docs/**": ["./public/fonts/NotoSansKR-Light.ttf", "./public/fonts/NotoSansKR-Bold.ttf"],
    "/api/admin/docs/**": ["./public/fonts/NotoSansKR-Light.ttf", "./public/fonts/NotoSansKR-Bold.ttf"],
    "/api/admin/audit-package/**": ["./public/fonts/NotoSansKR-Light.ttf", "./public/fonts/NotoSansKR-Bold.ttf"],
    "/api/admin/document-versions/**": ["./public/fonts/NotoSansKR-Light.ttf", "./public/fonts/NotoSansKR-Bold.ttf"],
  },

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
