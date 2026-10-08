// lib/safeLink.ts
// 공지·알림의 이동 링크 검증 — 앱 내부 경로만 허용한다.
//
// 2026-10-08 감사 P3: 매니저가 공지에 임의 URL을 넣을 수 있었고, 수신 화면은 router.push(link)로 이동하므로
//  외부 주소(피싱 페이지)로 보낼 수 있었다. '/'로 시작하는 단일 경로만 통과시킨다.
//  · '//evil.com'(프로토콜 상대 URL)·'/\evil.com'(브라우저가 '//'로 정규화)·'javascript:'·'https://' 는 모두 거부.
//  · 제어문자(개행·탭 등)는 일부 브라우저가 제거한 뒤 해석하므로 우회에 쓰인다 → 거부.

export const MAX_LINK_LENGTH = 300;

/** 내부 경로면 그대로, 아니면 null. */
export function internalLinkOrNull(link: unknown): string | null {
  if (typeof link !== "string") return null;
  const v = link.trim();
  if (!v || v.length > MAX_LINK_LENGTH) return null;
  if (!v.startsWith("/")) return null;
  if (v.startsWith("//") || v.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null;
  return v;
}
