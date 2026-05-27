// lib/adminSession.ts
// 관리자 세션 토큰(JWT) 발급/검증 유틸을 제공합니다.

import { SignJWT, jwtVerify } from "jose";

export type AdminSessionPayload = {
  sub: string; // adminUserId
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;
  agencyId?: string | null;
  agencyName?: string | null;
};

export const ADMIN_SESSION_COOKIE_NAME: string =
  process.env.ADMIN_SESSION_COOKIE ?? "admlink_admin_session";

export const ADMIN_SESSION_MAX_AGE_SEC: number = Number(
  process.env.ADMIN_SESSION_MAX_AGE_SEC || "604800"
); // default 7d

const ADMIN_TOKEN_AUD = "ablelink-admin";

function getSecretKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signAdminSessionToken(payload: AdminSessionPayload) {
  const secretKey = getSecretKey();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(ADMIN_TOKEN_AUD)
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SEC}s`)
    .sign(secretKey);
}

export async function verifyAdminSessionToken(
  token: string
): Promise<AdminSessionPayload | null> {
  const secretKey = getSecretKey();
  let payload: any;

  try {
    // 신규 토큰: aud 포함
    const result = await jwtVerify(token, secretKey, { audience: ADMIN_TOKEN_AUD });
    payload = result.payload;
  } catch {
    // 구 토큰(aud 없는) 한시적 수용 — 7일 후 자동 만료
    try {
      const result = await jwtVerify(token, secretKey);
      payload = result.payload;
    } catch {
      return null;
    }
  }

  const sub = String(payload.sub || "");
  const role = String(payload.role || "");
  const loginId = String(payload.loginId || "");

  const agencyIdRaw = payload.agencyId ?? null;
  const agencyNameRaw = payload.agencyName ?? null;

  const agencyId = agencyIdRaw == null || agencyIdRaw === "" ? null : String(agencyIdRaw);
  const agencyName = agencyNameRaw == null || agencyNameRaw === "" ? null : String(agencyNameRaw);

  if (!sub || !role || !loginId) return null;
  if (!["ADMIN", "GOV", "AGENCY"].includes(role)) return null;

  // AGENCY role이면 agencyId 필수
  if (role === "AGENCY" && !agencyId) return null;

  return { sub, role: role as any, loginId, agencyId, agencyName };
}
