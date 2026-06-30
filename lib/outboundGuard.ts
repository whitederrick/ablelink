// lib/outboundGuard.ts
// 외부 부수효과(이메일·알림톡·SMS·결제) 호출을 "운영에서만" 실제 실행한다.
// 로컬 dev에서는 차단(로그만) → 개발 중 실제 메일/문자/결제가 나가는 사고를 막는다.
//
// 판정 규칙:
//   - OUTBOUND_LIVE=1     → 어디서든 허용(개발 중 실제 발송을 테스트하고 싶을 때 명시적 강제)
//   - DB_ENV=development  → 차단 (로컬 개발 .env)
//   - 그 외               → NODE_ENV === "production" 일 때만 허용
// (운영 Vercel = NODE_ENV production · DB_ENV 미설정 → 허용. 로컬 dev = DB_ENV development → 차단.)
//
// ⚠️ staging(Vercel Preview, NODE_ENV=production) 추가 시에는 staging에 DB_ENV=development 또는
//    별도 차단 플래그를 줘서 실발송을 막아야 한다(현재는 staging 없음).
export function outboundAllowed(): boolean {
  if (process.env.OUTBOUND_LIVE === "1") return true;
  if (process.env.DB_ENV === "development") return false;
  return process.env.NODE_ENV === "production";
}

export function logOutboundSkip(channel: string, detail: string): void {
  console.log(`[outbound-skip:${channel}] dev 안전모드 — 실제 발송 안 함 · ${detail}`);
}
