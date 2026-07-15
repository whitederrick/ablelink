// next.config.ts
import type { NextConfig } from "next";

// (P2-15 CSP 이력: 2026-07-09 enforce가 카카오 지도를 깨서 롤백 → 2026-07-15 Report-Only 재도입 후
//  같은 날 enforce 전환. 전환 근거 = 출시 전 능동 전수검증: enforce 모드로 지도 플로(주소검색→핀·타일)+
//  매니저 12화면+워커 8화면 순회, CSP 차단·네트워크 실패 0(트래픽 없는 RO 수집 대기는 무의미 — 사용자 결정).
//  위반 보고는 /api/csp-report로 계속 수집. script의 unsafe-inline/unsafe-eval은 Next 하이드레이션·
//  카카오 SDK 때문에 허용 — nonce 전환은 별도 과제.)
const csp = [
  "default-src 'self'",
  // 카카오 지도(dapi/daumcdn)·주소검색(postcode)·토스 결제 SDK·Vercel Analytics(RO 수집에서 발견)
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' dapi.kakao.com *.daumcdn.net js.tosspayments.com va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  // 서명/지도 타일/수파베이스 signed URL·데이터 URI(서명 캔버스)·blob(PDF 뷰어)
  "img-src 'self' data: blob: *.supabase.co *.daumcdn.net *.kakaocdn.net *.kakao.com",
  "font-src 'self' data:",
  "connect-src 'self' *.supabase.co dapi.kakao.com *.tosspayments.com va.vercel-scripts.com",
  // 주소검색 iframe·토스 결제창
  "frame-src 'self' postcode.map.daum.net *.tosspayments.com pay.toss.im",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "report-uri /api/csp-report",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },

  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): 동일 출처에서만 마이크 허용 (AI 일지 음성 녹음용)
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs"],

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
