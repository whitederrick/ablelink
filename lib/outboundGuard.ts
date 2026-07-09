// lib/outboundGuard.ts
// 외부 부수효과(이메일·알림톡·SMS·결제) 호출을 "운영에서만" 실제 실행한다.
// 로컬 dev에서는 차단(로그만) → 개발 중 실제 메일/문자/결제가 나가는 사고를 막는다.
//
// 판정 규칙:
//   - OUTBOUND_LIVE=1        → 어디서든 허용(개발 중 실제 발송을 테스트하고 싶을 때 명시적 강제)
//   - DB_ENV=development     → 차단 (로컬 개발 .env)
//   - VERCEL_ENV=preview     → 차단 (프리뷰/PR 배포)
//   - 그 외                  → NODE_ENV === "production" 일 때만 허용
// ★기존 운영 동작(NODE_ENV=production → 허용)은 그대로 두되, Vercel Preview/PR 배포(NODE_ENV=production
//  이지만 VERCEL_ENV=preview)만 명시적으로 차단한다. NODE_ENV 기준만이면 프리뷰가 실제 알림톡·이메일·
//  토스 결제를 실사용자/실카드로 내보낼 수 있었다. (VERCEL_ENV 미노출 환경에서도 운영 발송은 유지 = 무회귀.)
export function outboundAllowed(): boolean {
  if (process.env.OUTBOUND_LIVE === "1") return true;
  if (process.env.DB_ENV === "development") return false;
  if (process.env.VERCEL_ENV === "preview") return false;
  return process.env.NODE_ENV === "production";
}

export function logOutboundSkip(channel: string, detail: string): void {
  console.log(`[outbound-skip:${channel}] dev 안전모드 — 실제 발송 안 함 · ${detail}`);
}
