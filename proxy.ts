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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 설계 원칙:
  //   API 라우트(/api/*) → 각 라우트가 자체 인증 처리
  //     (requireAdminSession / getWorkerSessionFromReq)
  //   페이지 라우트(/admin/*, /worker/*) → 미들웨어가 로그인 리다이렉트
  //
  // 따라서 새 API 라우트를 추가할 때 이 파일을 건드릴 필요가 없음.
  // 새 페이지 라우트 추가 시:
  //   - 공개 페이지면 아래 allowlist에 추가
  //   - 보호 페이지면 자동으로 로그인 리다이렉트됨 (별도 작업 불필요)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // ── API 라우트: 미들웨어 개입 없음 (각 라우트 자체 인증) ──
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // ── 관리자 페이지: 로그인 페이지는 공개 ─────────────────────
  if (pathname.startsWith("/admin/login")) return NextResponse.next();

  if (pathname.startsWith("/admin")) {
    if (await verifyAdminSession(req)) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // ── 직무지도원 페이지: 공개 페이지 목록 ─────────────────────
  // 새로운 공개 페이지가 생기면 여기에만 추가하면 됨
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
  // API 라우트는 각 라우트가 자체 인증 처리 → matcher에서 제외
  matcher: [
    "/admin/:path*",
    "/worker/:path*",
  ],
};
