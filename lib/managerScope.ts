// lib/managerScope.ts
// 에이전시 관리자 API 공통 세션/스코프 강제 유틸

import "server-only";
import { NextResponse } from "next/server";
import { readManagerSessionFromRequest } from "@/lib/managerCookies";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { parseBigInt } from "@/lib/adminScope";

export type ManagerScope = {
  managerId: bigint;  // ManagerUser.id
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

  if (mgr) {
    const managerId = parseBigInt(mgr.sub);
    const agencyId  = parseBigInt(mgr.agencyId);
    if (managerId && agencyId)
      return { kind: "manager", managerId, agencyId, loginId: mgr.loginId };
  }

  if (adm) {
    const adminId = parseBigInt(adm.sub);
    if (adminId) return { kind: "admin", adminId, loginId: String(adm.loginId) };
  }

  throw jsonError(401, "UNAUTHORIZED");
}
