// next.config.ts
import type { NextConfig } from "next";

// CSP는 2026-07-16 nonce 전환으로 proxy.ts(요청별 발급)로 이동 — 정책 본문은 lib/csp.ts 단일 소스.
//  (여기 고정 헤더로는 요청마다 다른 nonce를 만들 수 없음. 이력·근거 주석도 lib/csp.ts 참조.)
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
  serverExternalPackages: ["pdfkit", "exceljs"],

  // PDF 생성(pdfkit) 라우트의 서버리스 함수 번들에 한글 폰트 포함
  // (public/은 기본적으로 함수 fs에 포함되지 않아 fs.readFileSync 실패 방지)
  // ★2026-07-21 감사 P2: 렌더러(lib/pdf/pdfkitRenderer.ts)가 실제로 쓰는 폰트는 HCR 4종인데 종전엔 미사용
  //  NotoSansKR 2종을 나열하고 payroll payslip·document-runs(zip/send) 라우트를 누락했다. 실사용 폰트·전
  //  PDF 라우트로 정정(설정이 죽은 문서가 되지 않게). ※폰트 파일 자체 축소(서브셋)는 공식 양식 글리프
  //  커버리지 시각검증이 필요한 별도 작업 — 근본적 번들 축소는 후속 과제.
  outputFileTracingIncludes: (() => {
    const HCR = [
      "./public/fonts/HCRDotum.ttf", "./public/fonts/HCRDotum-Bold.ttf",
      "./public/fonts/HCRBatang.ttf", "./public/fonts/HCRBatang-Bold.ttf",
    ];
    return {
      "/api/worker/docs/**": HCR,
      "/api/admin/docs/**": HCR,
      "/api/admin/audit-package/**": HCR,
      "/api/admin/document-versions/**": HCR,
      "/api/admin/document-runs/**": HCR, // zip·send
      "/api/worker/payroll/**": HCR,      // payslip
      "/api/admin/payroll/**": HCR,       // payslip
    };
  })(),

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
