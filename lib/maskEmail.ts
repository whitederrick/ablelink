// lib/maskEmail.ts
// 감사 로그용 이메일 마스킹 — 로컬파트는 앞 2자만, 도메인은 유지(수신 기관 식별은 가능하되 개인 주소는 복원 불가).
export function maskEmailForLog(email: string): string {
  const e = email.trim();
  const at = e.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}
