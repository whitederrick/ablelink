// lib/tempPassword.ts
// 임시 비밀번호 생성 — 계정 초기화 공용. 혼동 문자(0/O, 1/l/I) 제외한 8자.
//  ★모든 콘솔(시스템운영자·위탁기관담당자)의 비번 초기화가 이 함수로 생성하고 응답에 평문을 담아 화면에 1회
//   표시한다(구두 안내 동선, 외부 발송 0건). 관리자가 임의 문자열을 직접 타이핑(마스킹)하던 비일관 UX를 통일.
import { randomInt } from "crypto";

const CHARS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generateTempPassword(length = 8): string {
  return Array.from({ length }, () => CHARS[randomInt(CHARS.length)]).join("");
}
