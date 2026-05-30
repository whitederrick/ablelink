// lib/adminScope.ts
// 시스템 운영자(Admin) API 공통 세션/스코프 강제 유틸

import "server-only";
import { NextResponse } from "next/server";
import { readAdminSessionFromRequest } from "@/lib/adminCookies";
import { prisma } from "@/lib/prisma";

/** URL 파라미터나 body의 id 문자열을 BigInt로 안전하게 변환. 실패 시 null 반환 */
export function parseBigInt(value: unknown): bigint | null {
  const s = String(value ?? "").trim();
  if (!s || !/^-?\d+$/.test(s)) return null;
  try { return BigInt(s); } catch { return null; }
}

export type AdminScope = {
  adminId: bigint; // Admin.id
  loginId: string;
};

function jsonError(status: number, message: string) {
  return NextResponse.json({ success: false, message }, { status });
}

export async function requireAdminSession(req: Request): Promise<AdminScope> {
  const s = await readAdminSessionFromRequest(req);
  if (!s) throw jsonError(401, "UNAUTHORIZED");

  const adminId = parseBigInt(s.sub);
  if (!adminId) throw jsonError(401, "UNAUTHORIZED");

  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { isActive: true },
  });
  if (!admin || !admin.isActive) throw jsonError(401, "ACCOUNT_DISABLED");

  return { adminId, loginId: String(s.loginId ?? "") };
}
