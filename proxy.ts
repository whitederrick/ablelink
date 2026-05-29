// proxy.ts
// 관리자 + 직무지도원 페이지 및 API 보호 (Next.js 16 proxy 컨벤션)

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_COOKIE  = process.env.ADMIN_SESSION_COOKIE || "admlink_admin_session";
const WORKER_COOKIE = "ablelink_worker_session";
const ADMIN_AUD     = "ablelink-admin";
const WORKER_AUD    = "ablelink-worker";

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
async function verifyToken(
  token: string,
  secret: Uint8Array,
  aud: string,
  allowedRoles: string[],
): Promise<string | null> {
  let payload: any;
  try {
    payload = (await jwtVerify(token, secret, { audience: aud })).payload;
  } catch {
    try {
      payload = (await jwtVerify(token, secret)).payload;
    } catch {
      return null;
    }
  }
  const role = String(payload?.role || "");
  return allowedRoles.includes(role) ? role : null;
}

async function getAdminRole(req: NextRequest): Promise<"ADMIN" | "AGENCY" | null> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const role = await verifyToken(token, getAdminSecret(), ADMIN_AUD, ["ADMIN", "AGENCY"]);
    return role as "ADMIN" | "AGENCY" | null;
  } catch { return null; }
}

async function verifyWorkerSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(WORKER_COOKIE)?.value;
  if (!token) return false;
  try {
    return (await verifyToken(token, getWorkerSecret(), WORKER_AUD, ["COACH"])) !== null;
  } catch { return false; }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // API 라우트 → 각 라우트가 자체 인증 처리, proxy 개입 없음
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // ── /admin (시스템 운영자 전용) ──────────────────────────────
  if (pathname.startsWith("/admin")) {
    if (pathname.startsWith("/admin/login")) return NextResponse.next();

    const role = await getAdminRole(req);
    if (!role) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    // AGENCY 역할이 /admin 접근 → /manager로 이동
    if (role === "AGENCY") {
      const url = req.nextUrl.clone();
      url.pathname = "/manager";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── /manager (에이전시 관리자 전용) ─────────────────────────
  if (pathname.startsWith("/manager")) {
    if (pathname.startsWith("/manager/login")) return NextResponse.next();

    const role = await getAdminRole(req);
    if (!role) {
      const url = req.nextUrl.clone();
      url.pathname = "/manager/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    // ADMIN 역할이 /manager 접근 → /admin으로 이동
    if (role === "ADMIN") {
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── /worker (직무지도원 전용) ────────────────────────────────
  const workerPublicPages = [
    "/worker/login",
    "/worker/signup",
    "/worker/invite/",
    "/worker/register",
    "/worker/reset-password",
    "/worker/subscribe/success",
    "/worker/subscribe/fail",
  ];
  if (workerPublicPages.some(p => pathname.startsWith(p))) return NextResponse.next();

  if (pathname.startsWith("/worker")) {
    if (await verifyWorkerSession(req)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/worker/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/manager/:path*",
    "/worker/:path*",
  ],
};
