// lib/adminSession.ts
// 시스템 운영자(Admin) 전용 JWT 세션

import { SignJWT, jwtVerify } from "jose";

export type AdminSessionPayload = {
  sub:     string; // Admin.id
  loginId: string;
  sv?:     number; // 세션 버전(비번 초기화 시 무효화). 미포함 구 토큰은 0으로 간주(하위호환).
};

export const ADMIN_SESSION_COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE ?? "admlink_admin_session";
export const ADMIN_SESSION_MAX_AGE_SEC = Number(process.env.ADMIN_SESSION_MAX_AGE_SEC || "604800");

const ADMIN_TOKEN_AUD = "ablelink-admin";

function getSecretKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signAdminSessionToken(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(ADMIN_TOKEN_AUD)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SEC}s`)
    .sign(getSecretKey());
}

export async function verifyAdminSessionToken(
  token: string
): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { audience: ADMIN_TOKEN_AUD });
    const sub     = String(payload.sub ?? "");
    const loginId = String((payload as any).loginId ?? "");
    const svRaw   = (payload as { sv?: unknown }).sv;
    const sv      = typeof svRaw === "number" ? svRaw : 0; // 미포함 구 토큰 = 0(하위호환)
    if (!sub || !loginId) return null;
    return { sub, loginId, sv };
  } catch {
    return null;
  }
}
