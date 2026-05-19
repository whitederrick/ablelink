// lib/adminCookies.ts
// 관리자 세션 쿠키 설정/삭제/읽기 유틸을 제공합니다.
// ✅ 운영 견고 버전: next/headers의 cookies()를 사용하지 않습니다.
//    - 쿠키 설정/삭제: NextResponse.cookies 사용
//    - 쿠키 읽기: Request 헤더의 cookie 문자열을 직접 파싱

import "server-only";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_SEC,
  type AdminSessionPayload,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from "@/lib/adminSession";

function getCookieValueFromHeader(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;

  // "a=1; b=2" 형태를 안전하게 파싱
  const parts = cookieHeader.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (!p) continue;
    const eq = p.indexOf("=");
    if (eq < 0) continue;

    const k = p.slice(0, eq).trim();
    if (k !== name) continue;

    const v = p.slice(eq + 1);
    // cookie value는 URL-encoding 되어 있을 수 있음
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

/**
 * ✅ 로그인 성공 응답에 세션 쿠키를 부착합니다.
 * - route handler에서 `const res = NextResponse.json(...);` 만든 뒤 호출하세요.
 */
export async function attachAdminSessionCookieToResponse(
  res: NextResponse,
  payload: AdminSessionPayload
) {
  const token = await signAdminSessionToken(payload);

  res.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_SEC,
  });

  return res;
}

/**
 * ✅ 로그아웃 응답에 세션 쿠키 삭제를 부착합니다.
 */
export function clearAdminSessionCookieOnResponse(res: NextResponse) {
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });

  return res;
}

/**
 * ✅ Request의 Cookie 헤더에서 세션을 읽어 검증합니다.
 * - cookies()를 쓰지 않으므로 타입/환경 영향이 없습니다.
 */
export async function readAdminSessionFromRequest(req: Request) {
  const raw = req.headers.get("cookie");
  const token = getCookieValueFromHeader(raw, ADMIN_SESSION_COOKIE_NAME);
  if (!token) return null;

  return await verifyAdminSessionToken(token);
}
