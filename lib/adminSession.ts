// lib/adminSession.ts
// 관리자 세션 토큰(JWT) 발급/검증 유틸을 제공합니다.
// (주의) cookies()는 route handler/server action에서만 사용하도록 분리합니다.

import { SignJWT, jwtVerify } from "jose";

export type AdminSessionPayload = {
  sub: string; // adminUserId
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;

  /**
   * ✅ AGENCY 스코프를 "정확히" 필터링하기 위한 기준값
   * - DB의 BigInt agencyId를 string으로 넣어두고, 사용하는 곳에서 BigInt로 변환
   * - AGENCY role이면 필수(verify에서 강제)
   */
  agencyId?: string | null;

  /**
   * (표시용) 기존 유지 가능
   * - 스코프/인가 판단에는 사용하지 않는 것을 권장
   */
  agencyName?: string | null;
};

export const ADMIN_SESSION_COOKIE_NAME: string =
  process.env.ADMIN_SESSION_COOKIE ?? "admlink_admin_session";

export const ADMIN_SESSION_MAX_AGE_SEC: number = Number(
  process.env.ADMIN_SESSION_MAX_AGE_SEC || "604800"
); // default 7d

function getSecretKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signAdminSessionToken(payload: AdminSessionPayload) {
  const secretKey = getSecretKey();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_MAX_AGE_SEC}s`)
    .sign(secretKey);
}

export async function verifyAdminSessionToken(
  token: string
): Promise<AdminSessionPayload | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);

    const sub = String(payload.sub || "");
    const role = String((payload as any).role || "");
    const loginId = String((payload as any).loginId || "");

    const agencyIdRaw = (payload as any).agencyId ?? null;
    const agencyNameRaw = (payload as any).agencyName ?? null;

    const agencyId =
      agencyIdRaw == null || agencyIdRaw === ""
        ? null
        : String(agencyIdRaw);

    const agencyName =
      agencyNameRaw == null || agencyNameRaw === ""
        ? null
        : String(agencyNameRaw);

    if (!sub || !role || !loginId) return null;
    if (!["ADMIN", "GOV", "AGENCY"].includes(role)) return null;

    // ✅ AGENCY role이면 agencyId 필수
    if (role === "AGENCY" && !agencyId) return null;

    return {
      sub,
      role: role as any,
      loginId,
      agencyId,
      agencyName,
    };
  } catch {
    return null;
  }
}
