// lib/adminScope.ts
// Admin API 공통 세션/스코프 강제 유틸

import "server-only";

/** URL 파라미터나 body의 id 문자열을 BigInt로 안전하게 변환. 실패 시 null 반환 */
export function parseBigInt(value: unknown): bigint | null {
  const s = String(value ?? "").trim();
  if (!s || !/^-?\d+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";

export type AdminScope = {
  userId: bigint;
  role: "ADMIN" | "GOV" | "AGENCY";
  loginId: string;

  /**
   * ✅ AGENCY 스코프의 정식 기준
   * - 토큰에 포함된 agencyId가 있으면 그대로 사용
   * - 없으면(레거시) agencyName으로 Agency를 조회해 id를 보강
   */
  agencyId: bigint | null;

  /**
   * (표시/레거시 fallback 용)
   */
  agencyName: string | null;
};

function jsonError(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

async function resolveAgencyIdByName(agencyName: string): Promise<bigint | null> {
  const a = await prisma.agency.findUnique({
    where: { name: agencyName },
    select: { id: true },
  });
  return a?.id ?? null;
}

export async function requireAdminSession(req: Request): Promise<AdminScope> {
  const s = await readAdminSessionFromRequest(req);
  if (!s) throw jsonError(401, "UNAUTHORIZED");

  const role = s.role;
  // ✅ 현재 정책: GOV는 차단
  if (role === "GOV") throw jsonError(403, "FORBIDDEN");

  const userId = BigInt(String(s.sub));
  const loginId = String(s.loginId);
  const agencyName = s.agencyName == null ? null : String(s.agencyName);

  // ✅ 신규 토큰(agencyId 포함) 우선
  let agencyId: bigint | null = null;
  const rawAgencyId = (s as any).agencyId;
  if (rawAgencyId != null && String(rawAgencyId).trim() !== "") {
    try {
      agencyId = BigInt(String(rawAgencyId));
    } catch {
      agencyId = null;
    }
  }

  // ✅ 레거시 fallback: agencyName -> Agency.id
  if (!agencyId && role === "AGENCY") {
    if (!agencyName) throw jsonError(403, "AGENCY_SCOPE_REQUIRED");
    const resolved = await resolveAgencyIdByName(agencyName);
    if (!resolved) throw jsonError(403, "AGENCY_SCOPE_REQUIRED");
    agencyId = resolved;
  }

  return {
    userId,
    role,
    loginId,
    agencyId,
    agencyName,
  };
}

export function requireAgencyScope(scope: AdminScope): bigint {
  if (!scope.agencyId) throw jsonError(403, "AGENCY_SCOPE_REQUIRED");
  return scope.agencyId;
}
