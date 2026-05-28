// 시스템 운영자 전용: 전체 에이전시 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") {
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

    const agencies = await prisma.agency.findMany({
      include: {
        _count: {
          select: {
            adminUsers: true,
            sites:      true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      agencies: agencies.map(a => ({
        id:          a.id.toString(),
        name:        a.name,
        planType:    a.planType,
        trialEndsAt: (a as any).trialEndsAt?.toISOString() ?? null,
        createdAt:   a.createdAt.toISOString(),
        managerCount: a._count.adminUsers,
        siteCount:    a._count.sites,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/agencies]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
