// 시스템 운영자 전용: 전체 통계
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const [agencyCount, coachCount, siteCount, traineeCount, subCount] = await Promise.all([
      prisma.agency.count(),
      prisma.worker.count(),
      prisma.site.count(),
      prisma.trainee.count({ where: { status: "TRAINING" } }),
      prisma.agency.count({ where: { planType: { in: ["STARTER", "STANDARD", "PRO"] } } }),
    ]);

    return NextResponse.json({
      success: true,
      stats: {
        agencyCount,
        coachCount,
        siteCount,
        traineeCount,
        activeSubscriptions: subCount,
      },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/stats]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
