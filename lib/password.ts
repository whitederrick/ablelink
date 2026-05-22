// lib/password.ts
// 비밀번호 해싱 유틸리티
// 🔐 보안: bcryptjs를 사용하여 평문 비밀번호 저장 방지

import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  // 기존 평문 비밀번호와의 하위 호환성 지원 (마이그레이션 기간 동안)
  // 해시값이 $2b$ 로 시작하면 bcrypt, 아니면 평문으로 간주
  if (hashed.startsWith("$2b$") || hashed.startsWith("$2a$")) {
    return bcrypt.compare(plain, hashed);
  }
  // 평문 일치 확인 후 해시로 자동 업그레이드 신호 반환 (호출부에서 처리)
  return plain === hashed;
}

export function isHashed(password: string): boolean {
  return password.startsWith("$2b$") || password.startsWith("$2a$");
}
