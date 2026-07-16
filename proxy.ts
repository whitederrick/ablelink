// proxy.ts
// ① 시스템 운영자(/admin), 에이전시 관리자(/manager), 직무지도원(/worker) 경로 보호
//    Admin(admins)와 Manager(managers)는 완전히 분리된 별도 쿠키·시크릿 사용
// ② CSP nonce 발급(2026-07-16) — 문서 요청마다 nonce를 생성해 요청 헤더(Next가 읽어 프레임워크
//    인라인 스크립트에 자동 주입)와 응답 헤더에 부착. 정책 본문은 lib/csp.ts 단일 소스.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { buildCsp, makeNonce } from "@/lib/csp";

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

// 문서 응답에 CSP(nonce) 부착 — 요청 헤더에 실어야 Next가 자기 인라인 스크립트에 nonce를 단다.
function nextWithCsp(req: NextRequest): NextResponse {
  const nonce = makeNonce();
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

// 경로 프리픽스 세그먼트 경계 판정 — startsWith("/worker")는 "/worker-manifest.json" 같은
// 루트 정적 파일까지 오탐해 로그인 리다이렉트를 일으킴(매처 전역 확장 시 실제 발생, 2026-07-16).
function inSection(pathname: string, section: string): boolean {
  return pathname === section || pathname.startsWith(section + "/");
}

// 인증 검사 — 차단(리다이렉트) 응답이 필요하면 반환, 통과면 null.
async function checkAuth(req: NextRequest, pathname: string): Promise<NextResponse | null> {
  // ── /admin (시스템 운영자 전용) ──────────────────────────────
  if (inSection(pathname, "/admin")) {
    if (pathname.startsWith("/admin/login")) return null;

    const token = req.cookies.get(ADMIN_COOKIE)?.value;
    if (!token) return redirectWithNext(req, "/admin/login");

    const valid = await verifyToken(token, getAdminSecret(), ADMIN_AUD);
    if (!valid) return redirectWithNext(req, "/admin/login");

    return null;
  }

  // ── /manager (에이전시 관리자 전용) ─────────────────────────
  if (inSection(pathname, "/manager")) {
    // 로그인·초대 온보딩(신규 관리자, 세션 없음)은 공개.
    if (pathname.startsWith("/manager/login") || pathname.startsWith("/manager/invite/")) return null;

    const token = req.cookies.get(MANAGER_COOKIE)?.value;
    if (!token) return redirectWithNext(req, "/manager/login");

    const valid = await verifyToken(token, getManagerSecret(), MANAGER_AUD);
    if (!valid) return redirectWithNext(req, "/manager/login");

    return null;
  }

  // ── /worker (직무지도원 전용) ────────────────────────────────
  const workerPublicPaths = [
    "/worker/login",
    "/worker/signup",
    "/worker/invite/",
    "/worker/register",
    "/worker/reset-password",
  ];
  if (workerPublicPaths.some(p => pathname.startsWith(p))) return null;

  if (inSection(pathname, "/worker")) {
    const token = req.cookies.get(WORKER_COOKIE)?.value;
    if (!token) return redirectWithNext(req, "/worker/login");

    const valid = await verifyToken(token, getWorkerSecret(), WORKER_AUD);
    if (!valid) return redirectWithNext(req, "/worker/login");

    return null;
  }

  return null;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // API 라우트 → 각 라우트가 자체 인증 처리(CSP는 문서 전용이라 미부착 — 종전과 동일 동작)
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const blocked = await checkAuth(req, pathname);
  if (blocked) return blocked; // 리다이렉트에는 문서 렌더가 없어 CSP 불필요

  return nextWithCsp(req);
}

export const config = {
  // CSP nonce는 모든 문서 경로에 균일 적용(랜딩 포함). 정적 에셋·이미지 최적화·API는 제외.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon\\.ico|sw\\.js|robots\\.txt|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|ttf|woff2?|json|webmanifest|txt|xml|map)$).*)",
  ],
};
