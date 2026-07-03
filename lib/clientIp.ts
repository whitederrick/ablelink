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
