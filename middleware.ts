// middleware.ts
// 관리자 + 직무지도원 페이지 및 API 보호 미들웨어

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const ADMIN_COOKIE = process.env.ADMIN_SESSION_COOKIE || "admlink_admin_session";
const WORKER_COOKIE = "ablelink_worker_session";

function getSecretKey() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not set");
  return new TextEncoder().encode(secret);
}

async function verifyAdminSession(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const role = String((payload as any).role || "");
    if (!["ADMIN", "GOV", "AGENCY"].includes(role)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyWorkerSession(req: NextRequest) {
  const token = req.cookies.get(WORKER_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    if ((payload as any).role !== "COACH") return null;
    return payload;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 관리자 영역 ──────────────────────────────────────────────
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  if (pathname.startsWith("/api/admin/auth/")) return NextResponse.next();

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    const session = await verifyAdminSession(req);
    if (session) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ── 직무지도원 영역 ──────────────────────────────────────────
  if (pathname.startsWith("/worker/login")) return NextResponse.next();
  if (pathname.startsWith("/worker/register")) return NextResponse.next();
  if (pathname.startsWith("/worker/subscribe/success")) return NextResponse.next();
  if (pathname.startsWith("/worker/subscribe/fail")) return NextResponse.next();
  if (pathname.startsWith("/api/worker/auth/")) return NextResponse.next();
  if (pathname.startsWith("/api/payments/")) return NextResponse.next();

  if (pathname.startsWith("/worker") || pathname.startsWith("/api/worker")) {
    const session = await verifyWorkerSession(req);
    if (session) return NextResponse.next();

    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
    }
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
    "/api/admin/:path*",
    "/worker/:path*",
    "/api/worker/:path*",
  ],
};
