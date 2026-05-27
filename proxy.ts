// proxy.ts
// 관리자 + 직무지도원 페이지 및 API 보호 (Next.js 16 proxy 컨벤션)

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_COOKIE  = process.env.ADMIN_SESSION_COOKIE || "admlink_admin_session";
const WORKER_COOKIE = "ablelink_worker_session";

const ADMIN_AUD  = "ablelink-admin";
const WORKER_AUD = "ablelink-worker";

function getAdminSecret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(s);
}

function getWorkerSecret() {
  const s = process.env.WORKER_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET;
  if (!s) throw new Error("WORKER_SESSION_SECRET not set");
  return new TextEncoder().encode(s);
}

// aud 포함 토큰 우선 검증, 구 토큰(aud 없는)은 한시적 폴백
async function verifyToken(token: string, secret: Uint8Array, aud: string, role: string | string[]): Promise<boolean> {
  const roles = Array.isArray(role) ? role : [role];
  let payload: any;
  try {
    payload = (await jwtVerify(token, secret, { audience: aud })).payload;
  } catch {
    try {
      payload = (await jwtVerify(token, secret)).payload;
    } catch {
      return false;
    }
  }
  return roles.includes(String(payload?.role || ""));
}

async function verifyAdminSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return false;
  try {
    return await verifyToken(token, getAdminSecret(), ADMIN_AUD, ["ADMIN", "GOV", "AGENCY"]);
  } catch { return false; }
}

async function verifyWorkerSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(WORKER_COOKIE)?.value;
  if (!token) return false;
  try {
    return await verifyToken(token, getWorkerSecret(), WORKER_AUD, "COACH");
  } catch { return false; }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 관리자 영역 ──────────────────────────────────────────────
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  if (pathname.startsWith("/api/admin/auth/")) return NextResponse.next();

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (await verifyAdminSession(req)) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ── 직무지도원 영역 ──────────────────────────────────────────
  const workerPublicPages = [
    "/worker/login",
    "/worker/register",
    "/worker/reset-password",
    "/worker/subscribe/success",
    "/worker/subscribe/fail",
  ];
  if (workerPublicPages.some(p => pathname.startsWith(p))) return NextResponse.next();
  if (pathname.startsWith("/api/worker/auth/")) return NextResponse.next();
  if (pathname.startsWith("/api/payments/")) return NextResponse.next();
  if (pathname.startsWith("/api/sign/")) return NextResponse.next();

  if (pathname.startsWith("/worker") || pathname.startsWith("/api/worker")) {
    if (await verifyWorkerSession(req)) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/worker/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ── 출퇴근/기준점 API (worker 인증 필요) ────────────────────
  if (pathname.startsWith("/api/attendance/") || pathname.startsWith("/api/site/basepoint/")) {
    if (await verifyWorkerSession(req)) return NextResponse.next();
    return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/admin/:path*",
    "/worker/:path*",
    "/api/worker/:path*",
    "/api/attendance/:path*",
    "/api/site/basepoint/:path*",
  ],
};
