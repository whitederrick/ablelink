// lib/managerSession.ts
// 에이전시 관리자(ManagerUser) 전용 JWT 세션

import { SignJWT, jwtVerify } from "jose";

export type ManagerSessionPayload = {
  sub:      string; // ManagerUser.id
  agencyId: string; // Agency.id (필수 — agencyId 없으면 토큰 발급 불가)
  loginId:  string;
};

export const MANAGER_SESSION_COOKIE_NAME = "admlink_manager_session";
export const MANAGER_SESSION_MAX_AGE_SEC = Number(
  process.env.MANAGER_SESSION_MAX_AGE_SEC || "604800" // 7일
);

const MANAGER_TOKEN_AUD = "ablelink-manager";

function getSecretKey() {
  const secret = process.env.MANAGER_SESSION_SECRET;
  if (!secret) throw new Error("MANAGER_SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signManagerSessionToken(
  payload: ManagerSessionPayload
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(MANAGER_TOKEN_AUD)
    .setIssuedAt()
    .setExpirationTime(`${MANAGER_SESSION_MAX_AGE_SEC}s`)
    .sign(getSecretKey());
}

export async function verifyManagerSessionToken(
  token: string
): Promise<ManagerSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      audience: MANAGER_TOKEN_AUD,
    });

    const sub      = String(payload.sub ?? "");
    const agencyId = String((payload as any).agencyId ?? "");
    const loginId  = String((payload as any).loginId ?? "");

    if (!sub || !agencyId || !loginId) return null;

    return { sub, agencyId, loginId };
  } catch {
    return null;
  }
}
