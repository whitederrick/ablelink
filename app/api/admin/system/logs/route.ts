// 시스템 운영자 전용: 감사 로그 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") ?? "";
    const limit  = Math.min(200, Number(searchParams.get("limit") ?? 100));

    const logs = await prisma.systemAuditLog.findMany({
      where: action ? { action: { contains: action } } : undefined,
      include: { admin: { select: { loginId: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      success: true,
      logs: logs.map(l => ({
        id:        l.id.toString(),
        action:    l.action,
        target:    l.target,
        detail:    l.detail,
        adminId:   l.adminId?.toString() ?? null,
        adminLogin: l.admin?.loginId ?? null,
        adminName:  l.admin?.displayName ?? null,
        ipAddress: l.ipAddress,
        createdAt: l.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
