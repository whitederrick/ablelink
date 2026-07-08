// lib/clientIp.ts
// 클라이언트 IP(접속지) 추출 공유 헬퍼.
//  · Vercel/프록시 뒤에서는 x-forwarded-for의 첫 홉이 실제 클라이언트 IP.
//  · 기존 라우트들이 각자 인라인으로 파싱하던 것을 단일화(개인정보 접속기록 IP 항목용).
export function getClientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real || null;
}

// 레이트리밋용 '신뢰' IP — 브루트포스 방어는 클라가 조작 못 하는 값이어야 한다.
//  · Vercel 엣지가 설정한 x-real-ip 우선(클라 조작 불가).
//  · 없으면 XFF의 '마지막' 엔트리(가장 가까운 프록시가 덧붙인 값). 첫 엔트리는 클라가 조작 가능하므로 쓰지 않는다.
// (접속기록/표시는 getClientIp = 첫 홉 클라 IP를 계속 사용 — 용도 분리.)
export function getRateLimitIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return null;
}
