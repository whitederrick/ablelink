// lib/csp.ts
// CSP 정책 단일 소스 — proxy.ts(요청별 nonce 발급)가 소비. next.config의 정적 CSP를 대체(2026-07-16).
//
// (P2-15 CSP 이력: 2026-07-09 enforce가 카카오 지도를 깨서 롤백 → 2026-07-15 RO 재도입 후 같은 날
//  enforce 전환(능동 전수검증) → 2026-07-16 nonce 전환으로 script-src 'unsafe-inline' 제거.
//  앱 코드에 인라인 <script> 없음(전수 grep) — nonce는 Next 프레임워크 인라인 스크립트용이며,
//  Next가 요청 헤더의 CSP에서 nonce를 읽어 자동 주입한다. 카카오/토스/애널리틱스는 전부 src 로드라
//  기존 도메인 allowlist로 동작(strict-dynamic 미사용 — allowlist 무효화 방지).
//  'unsafe-eval'은 유지 — eval 제거 시도 실측(2026-07-16 지도 플로 e2e)에서 카카오 SDK가 eval을 실제
//  사용(script-src ← eval 위반 1건 발생, 지도 자체는 렌더되나 잠재 회귀 위험). unsafe-inline 제거가
//  본질(XSS 주입 벡터)이고 eval은 기실행 권한 전제라 위험도 낮음 — 카카오 SDK 요구사항으로 문서화.
//  위반 보고는 /api/csp-report 계속 수집.)

export function buildCsp(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 카카오 지도(dapi/daumcdn)·주소검색(postcode)·토스 결제 SDK·Vercel Analytics — 전부 src 로드(allowlist).
    // 'unsafe-eval'=카카오 SDK 실측 요구(상단 주석). dev는 react-refresh/HMR용 인라인 완화 추가.
    `script-src 'self' 'nonce-${nonce}' 'unsafe-eval'${dev ? " 'unsafe-inline'" : ""} dapi.kakao.com *.daumcdn.net js.tosspayments.com va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'", // styled-jsx·인라인 style 속성 — 스크립트 실행면 아님(잔여 과제)
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
}

export function makeNonce(): string {
  // edge/node 겸용(btoa·crypto.randomUUID 양쪽 존재). base64로 CSP nonce 문법 충족.
  return btoa(crypto.randomUUID());
}
