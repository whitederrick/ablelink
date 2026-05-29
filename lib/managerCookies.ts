// lib/managerCookies.ts
// 에이전시 관리자 세션 쿠키 관리

import "server-only";
import { NextResponse } from "next/server";
import {
  MANAGER_SESSION_COOKIE_NAME,
  MANAGER_SESSION_MAX_AGE_SEC,
  type ManagerSessionPayload,
  signManagerSessionToken,
  verifyManagerSessionToken,
} from "@/lib/managerSession";

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

export async function attachManagerSessionCookieToResponse(
  res: NextResponse,
  payload: ManagerSessionPayload
): Promise<NextResponse> {
  const token = await signManagerSessionToken(payload);
  res.cookies.set({
    name:     MANAGER_SESSION_COOKIE_NAME,
    value:    token,
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   MANAGER_SESSION_MAX_AGE_SEC,
  });
  return res;
}

export function clearManagerSessionCookieOnResponse(res: NextResponse): NextResponse {
  res.cookies.set({
    name:     MANAGER_SESSION_COOKIE_NAME,
    value:    "",
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    path:     "/",
    maxAge:   0,
  });
  return res;
}

export async function readManagerSessionFromRequest(
  req: Request
): Promise<ManagerSessionPayload | null> {
  const token = getCookieValue(req.headers.get("cookie"), MANAGER_SESSION_COOKIE_NAME);
  if (!token) return null;
  return verifyManagerSessionToken(token);
}
