// lib/adminCookies.ts
// 시스템 운영자 세션 쿠키 관리

import "server-only";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_SEC,
  type AdminSessionPayload,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from "@/lib/adminSession";

function getCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.trim().indexOf("=");
    if (eq < 0) continue;
    if (part.trim().slice(0, eq).trim() === name) {
      try { return decodeURIComponent(part.trim().slice(eq + 1)); } catch { return part.trim().slice(eq + 1); }
    }
  }
  return null;
}

export async function attachAdminSessionCookieToResponse(
  res: NextResponse,
  payload: AdminSessionPayload
): Promise<NextResponse> {
  const token = await signAdminSessionToken(payload);
  res.cookies.set({
    name:     ADMIN_SESSION_COOKIE_NAME,
    value:    token,
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   ADMIN_SESSION_MAX_AGE_SEC,
  });
  return res;
}

export function clearAdminSessionCookieOnResponse(res: NextResponse): NextResponse {
  res.cookies.set({
    name:     ADMIN_SESSION_COOKIE_NAME,
    value:    "",
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   0,
  });
  return res;
}

export async function readAdminSessionFromRequest(
  req: Request
): Promise<AdminSessionPayload | null> {
  const token = getCookieValue(req.headers.get("cookie"), ADMIN_SESSION_COOKIE_NAME);
  if (!token) return null;
  return verifyAdminSessionToken(token);
}
