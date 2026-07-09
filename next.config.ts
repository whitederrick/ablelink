// next.config.ts
import type { NextConfig } from "next";

// P2-15 CSP(enforce). 앱이 실제 사용하는 외부 호스트만 화이트리스트한다(코드 전수 grep 기준):
//  · 카카오맵 SDK/지오코딩 dapi.kakao.com·타일/이미지 *.daumcdn.net
//  · 리플릿(unpkg)+OpenStreetMap 타일 *.tile.openstreetmap.org
//  · 토스 결제 js/api.tosspayments.com·결제 iframe *.tosspayments.com
//  · Supabase 스토리지/API *.supabase.co · Vercel Analytics va.vercel-scripts.com/*.vercel-insights.com
// script/style은 Next.js 하이드레이션·인라인 및 지도 SDK(eval) 때문에 'unsafe-inline'/'unsafe-eval' 허용하되,
// 실질 방어(외부 유출·악성 프레임·클릭재킹·base/form 하이재킹)는 connect/frame/object/base/form/frame-ancestors로 건다.
const csp = [
  "default-src 'self'",
  // 지도/결제 SDK는 여러 벤더 서브도메인을 동적으로 로드·연결하므로 벤더 단위 와일드카드로 허용
  //  (*.kakao.com·*.daumcdn.net=카카오맵, *.tosspayments.com=토스 결제 위젯/이벤트/게이트웨이).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.kakao.com https://*.daumcdn.net https://*.daum.net https://*.kakaocdn.net https://*.tosspayments.com https://unpkg.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: blob: https://*.supabase.co https://*.kakao.com https://*.daumcdn.net https://*.daum.net https://*.kakaocdn.net https://*.tile.openstreetmap.org",
  "connect-src 'self' https://*.supabase.co https://*.kakao.com https://*.daumcdn.net https://*.daum.net https://*.kakaocdn.net https://*.tosspayments.com https://*.vercel-insights.com",
  "frame-src 'self' https://*.tosspayments.com https://*.kakao.com",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://*.tosspayments.com",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // microphone=(self): 동일 출처에서만 마이크 허용 (AI 일지 음성 녹음용)
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self), interest-cohort=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: csp },
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
