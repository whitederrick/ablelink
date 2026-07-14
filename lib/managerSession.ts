// lib/managerSession.ts
// 위탁기관 관리자(Manager) 전용 JWT 세션

import { SignJWT, jwtVerify } from "jose";

export type ManagerSessionPayload = {
  sub:      string; // Manager.id
  agencyId: string; // Agency.id (필수 — agencyId 없으면 토큰 발급 불가)
  loginId:  string;
  sv?:      number; // 세션 버전(비번 초기화 시 무효화). 미포함 구 토큰은 0으로 간주(하위호환).
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
    const svRaw    = (payload as { sv?: unknown }).sv;
    const sv       = typeof svRaw === "number" ? svRaw : 0; // 미포함 구 토큰 = 0(하위호환)

    if (!sub || !agencyId || !loginId) return null;

    return { sub, agencyId, loginId, sv };
  } catch {
    return null;
  }
}
