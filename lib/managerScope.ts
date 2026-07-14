// lib/managerScope.ts
// 위탁기관 관리자 API 공통 세션/스코프 강제 유틸

import "server-only";
import { NextResponse } from "next/server";
import { readManagerSessionFromRequest } from "@/lib/managerCookies";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { parseBigInt } from "@/lib/adminScope";
import { prisma } from "@/lib/prisma";

export type ManagerScope = {
  managerId: bigint;  // Manager.id
  agencyId:  bigint;  // Agency.id — 항상 존재 (토큰 발급 시 필수)
  loginId:   string;
};

function jsonError(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function requireManagerSession(req: Request): Promise<ManagerScope> {
  const session = await readManagerSessionFromRequest(req);
  if (!session) throw jsonError(401, "UNAUTHORIZED");

  const managerId = parseBigInt(session.sub);
  const agencyId  = parseBigInt(session.agencyId);

  if (!managerId || !agencyId) throw jsonError(401, "UNAUTHORIZED");

  // 토큰이 유효해도 계정 비활성/소속변경/비번초기화(sessionVersion) 시 무효화 (매 요청 DB 재검증, 추가 쿼리 0)
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    select: { isActive: true, agencyId: true, sessionVersion: true },
  });
  if (!manager || !manager.isActive) throw jsonError(401, "ACCOUNT_DISABLED");
  if (manager.agencyId !== agencyId) throw jsonError(401, "UNAUTHORIZED");
  if (manager.sessionVersion !== (session.sv ?? 0)) throw jsonError(401, "SESSION_EXPIRED");

  return { managerId, agencyId, loginId: session.loginId };
}

// ADMIN 또는 MANAGER 둘 다 접근 가능한 라우트용
export type DualSession =
  | { kind: "admin";   adminId: bigint;   loginId: string }
  | { kind: "manager"; managerId: bigint; agencyId: bigint; loginId: string };

export async function requireAdminOrManagerSession(req: Request): Promise<DualSession> {
  const [mgr, adm] = await Promise.all([
    readManagerSessionFromRequest(req),
    readAdminSessionFromRequest(req),
  ]);

  // 운영자 콘솔에서 호출(x-admin-context: 1 헤더 또는 adminctx=1 쿼리)이면, 매니저 쿠키가 함께 있어도 admin으로 동작.
  // (헤더를 못 싣는 iframe/href PDF·첨부 URL 대비 쿼리파라미터도 허용. 운영자+매니저 동시 로그인 시 매니저 우선 방지)
  let preferAdmin = req.headers.get("x-admin-context") === "1";
  if (!preferAdmin) { try { preferAdmin = new URL(req.url).searchParams.get("adminctx") === "1"; } catch { /* noop */ } }
  if (adm && preferAdmin) {
    const adminId = parseBigInt(adm.sub);
    if (adminId) {
      const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { isActive: true, sessionVersion: true } });
      if (admin && admin.isActive && admin.sessionVersion === (adm.sv ?? 0))
        return { kind: "admin", adminId, loginId: String(adm.loginId) };
    }
  }

  if (mgr) {
    const managerId = parseBigInt(mgr.sub);
    const agencyId  = parseBigInt(mgr.agencyId);
    if (managerId && agencyId) {
      const manager = await prisma.manager.findUnique({
        where: { id: managerId },
        select: { isActive: true, agencyId: true, sessionVersion: true },
      });
      if (manager && manager.isActive && manager.agencyId === agencyId && manager.sessionVersion === (mgr.sv ?? 0))
        return { kind: "manager", managerId, agencyId, loginId: mgr.loginId };
    }
  }

  if (adm) {
    const adminId = parseBigInt(adm.sub);
    if (adminId) {
      const admin = await prisma.admin.findUnique({ where: { id: adminId }, select: { isActive: true, sessionVersion: true } });
      if (admin && admin.isActive && admin.sessionVersion === (adm.sv ?? 0))
        return { kind: "admin", adminId, loginId: String(adm.loginId) };
    }
  }

  throw jsonError(401, "UNAUTHORIZED");
}

// dual 세션에서 작업 대상 agencyId 결정:
// - manager: 본인 agencyId 강제(요청값 무시 — 스코프 이탈 방지)
// - admin(운영자): 요청에서 받은 agencyId 사용(필수). 운영자는 모든 위탁기관를 관리.
export function resolveScopeAgencyId(session: DualSession, requested?: string | bigint | null): bigint {
  if (session.kind === "manager") return session.agencyId;
  const parsed = typeof requested === "bigint" ? requested : parseBigInt(String(requested ?? ""));
  if (!parsed) throw jsonError(400, "AGENCY_REQUIRED");
  return parsed;
}
