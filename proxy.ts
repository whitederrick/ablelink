// proxy.ts
// 시스템 운영자(/admin), 에이전시 관리자(/manager), 직무지도원(/worker) 경로 보호
// Admin(admins)와 Manager(managers)는 완전히 분리된 별도 쿠키·시크릿 사용

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_COOKIE   = process.env.ADMIN_SESSION_COOKIE ?? "admlink_admin_session";
const MANAGER_COOKIE = "admlink_manager_session";
const WORKER_COOKIE  = "ablelink_worker_session";

const ADMIN_AUD   = "ablelink-admin";
const MANAGER_AUD = "ablelink-manager";
const WORKER_AUD  = "ablelink-worker";

function getAdminSecret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

function getManagerSecret() {
  const s = process.env.MANAGER_SESSION_SECRET;
  if (!s) throw new Error("MANAGER_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

function getWorkerSecret() {
  const s = process.env.WORKER_SESSION_SECRET;
  if (!s) throw new Error("WORKER_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

async function verifyToken(token: string, secret: Uint8Array, aud: string): Promise<boolean> {
  try {
    await jwtVerify(token, secret, { audience: aud });
    return true;
  } catch {
    return false;
  }
}

function redirect(req: NextRequest, pathname: string): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = pathname;
  url.search   = "";
  return NextResponse.redirect(url);
}

function redirectWithNext(req: NextRequest, loginPath: string): NextResponse {
  const url = req.nextUrl.clone();
  url.searchParams.set("next", req.nextUrl.pathname);
  url.pathname = loginPath;
  return NextResponse.redirect(url);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API 라우트 → 각 라우트가 자체 인증 처리
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // ── /admin (시스템 운영자 전용) ──────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (pathname.startsWith("/admin/login")) return NextResponse.next();

    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!token) return redirectWithNext(req, "/admin/login");

    const valid = await verifyToken(token, getAdminSecret(), ADMIN_AUD);
    if (!valid) return redirectWithNext(req, "/admin/login");

    return NextResponse.next();
  }

  // ── /manager (에이전시 관리자 전용) ─────────────────────────
  if (pathname.startsWith("/manager")) {
    if (pathname.startsWith("/manager/login")) return NextResponse.next();

    const token = req.cookies.get(MANAGER_COOKIE)?.value;
    if (!token) return redirectWithNext(req, "/manager/login");

    const valid = await verifyToken(token, getManagerSecret(), MANAGER_AUD);
    if (!valid) return redirectWithNext(req, "/manager/login");

    return NextResponse.next();
  }

  // ── /worker (직무지도원 전용) ────────────────────────────────
  const workerPublicPaths = [
    "/worker/login",
    "/worker/signup",
    "/worker/invite/",
    "/worker/register",
    "/worker/reset-password",
    "/worker/subscribe/success",
    "/worker/subscribe/fail",
  ];
  if (workerPublicPaths.some(p => pathname.startsWith(p))) return NextResponse.next();

  if (pathname.startsWith("/worker")) {
    const token = req.cookies.get(WORKER_COOKIE)?.value;
    if (!token) return redirectWithNext(req, "/worker/login");

    const valid = await verifyToken(token, getWorkerSecret(), WORKER_AUD);
    if (!valid) return redirectWithNext(req, "/worker/login");

    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/manager/:path*", "/worker/:path*"],
};
