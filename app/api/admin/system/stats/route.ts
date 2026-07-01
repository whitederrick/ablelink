// 시스템 운영자 전용: 전체 통계
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { PAID_AGENCY_PLANS } from "@/lib/plans";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    // 훈련생 카드 숫자는 훈련생 현황 화면(/admin/trainees, ACTIVE 배정 현장의 TRAINING)과 동일 모집단으로 맞춤.
    // (이전엔 전체 TRAINING count라 화면과 어긋났고 카드 링크도 현장 화면을 가리켰음)
    const activeSiteIds = (
      await prisma.siteAssignment.findMany({ where: { status: "ACTIVE" }, select: { siteId: true }, distinct: ["siteId"] })
    ).map(a => a.siteId);

    const [agencyCount, workerCount, siteCount, traineeCount, subCount] = await Promise.all([
      prisma.agency.count(),
      prisma.worker.count(),
      prisma.site.count(),
      prisma.trainee.count({ where: { status: "TRAINING", currentSiteId: { in: activeSiteIds } } }),
      prisma.agency.count({ where: { planType: { in: PAID_AGENCY_PLANS } } }),
    ]);

    return NextResponse.json({
      success: true,
      stats: {
        agencyCount,
        workerCount,
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
