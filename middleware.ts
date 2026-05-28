import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = process.env.ADMIN_SESSION_COOKIE ?? "admlink_admin_session";
const TOKEN_AUD   = "ablelink-admin";

function getSecret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s) return null;
  return new TextEncoder().encode(s);
}

async function getRole(req: NextRequest): Promise<"ADMIN" | "AGENCY" | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const secret = getSecret();
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { audience: TOKEN_AUD });
    const role = String((payload as any).role || "");
    if (role === "ADMIN" || role === "AGENCY") return role;
    return null;
  } catch {
    // 구 토큰(aud 없음) 한시적 수용
    try {
      const { payload } = await jwtVerify(token, secret);
      const role = String((payload as any).role || "");
      if (role === "ADMIN" || role === "AGENCY") return role;
    } catch {}
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── /admin 경로 (시스템 운영자 전용) ──────────────────────────
  if (pathname.startsWith("/admin")) {
    if (pathname.startsWith("/admin/login")) return NextResponse.next();

    const role = await getRole(req);
    if (!role) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (role === "AGENCY") {
      // 에이전시 관리자가 /admin에 접근 → /manager로 이동
      const url = req.nextUrl.clone();
      url.pathname = "/manager";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ── /manager 경로 (에이전시 관리자 전용) ──────────────────────
  if (pathname.startsWith("/manager")) {
    if (pathname.startsWith("/manager/login")) return NextResponse.next();

    const role = await getRole(req);
    if (!role) {
      const url = req.nextUrl.clone();
      url.pathname = "/manager/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (role === "ADMIN") {
      // 시스템 운영자가 /manager에 접근 → /admin으로 이동
      const url = req.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/manager/:path*"],
};
