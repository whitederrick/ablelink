// middleware.ts
// 엣지 레벨 라우트 보호 — 세션 쿠키 없으면 로그인 페이지로 리다이렉트

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_COOKIE  = process.env.ADMIN_SESSION_COOKIE  ?? "admlink_admin_session";
const WORKER_COOKIE = "ablelink_worker_session";

function getSecret(raw: string | undefined) {
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

async function hasValidToken(token: string | undefined, secret: Uint8Array | null, aud: string): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, secret, { audience: aud });
    return true;
  } catch {
    // 구 토큰(aud 없는)도 한시적으로 허용 — audience 검증 실패만 재시도
    try {
      await jwtVerify(token, secret);
      return true;
    } catch {
      return false;
    }
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 어드민 라우트 보호 (/admin/* 단, /admin/login 제외) ───────────
  if (pathname.startsWith("/admin") && !pathname.startsWith("/admin/login")) {
    const token  = req.cookies.get(ADMIN_COOKIE)?.value;
    const secret = getSecret(process.env.ADMIN_SESSION_SECRET);
    const valid  = await hasValidToken(token, secret, "ablelink-admin");
    if (!valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      return NextResponse.redirect(url);
    }
  }

  // ── 워커 라우트 보호 (/worker/* 단, 공개 페이지 제외) ────────────
  const workerPublic = ["/worker/login", "/worker/register", "/worker/reset-password"];
  if (pathname.startsWith("/worker") && !workerPublic.some(p => pathname.startsWith(p))) {
    const token  = req.cookies.get(WORKER_COOKIE)?.value;
    const rawSecret = process.env.WORKER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
    const secret = getSecret(rawSecret);
    const valid  = await hasValidToken(token, secret, "ablelink-worker");
    if (!valid) {
      const url = req.nextUrl.clone();
      url.pathname = "/worker/login";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/worker/:path*"],
};
