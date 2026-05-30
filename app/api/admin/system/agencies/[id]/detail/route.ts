// 시스템 운영자: 에이전시 상세 조회
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const agencyId = parseBigInt(id);
    if (!agencyId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });

    // 에이전시 존재 확인 후 병렬 조회
    const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
    if (!agency) return NextResponse.json({ success: false, message: "에이전시를 찾을 수 없습니다." }, { status: 404 });

    const [managers, sites, workers, logCount, attCount, apiUsage] = await Promise.all([
      prisma.manager.findMany({ where: { agencyId }, select: { id: true, loginId: true, displayName: true, isActive: true, lastLoginAt: true } }),
      prisma.site.findMany({
        where: { agencyId },
        include: { trainees: { where: { status: "TRAINING" }, select: { id: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.siteAssignment.findMany({
        where: { agencyId, status: { in: ["ACTIVE","ASSIGNED","CONFIRMED"] } },
        include: { user: { select: { id: true, userName: true, status: true } } },
        orderBy: { startDate: "desc" },
      }),
      prisma.traineeLog.count({
        where: { attendance: { site: { agencyId } } },
      }),
      prisma.dailyAttendance.count({
        where: { site: { agencyId } },
      }),
      prisma.apiCallLog.groupBy({
        by: ["service"],
        where: { agencyId },
        _count: { id: true },
      }),
    ]);

    const uniqueWorkers = new Map<string, any>();
    for (const a of workers) {
      const uid = a.user.id.toString();
      if (!uniqueWorkers.has(uid)) uniqueWorkers.set(uid, { id: uid, userName: a.user.userName, status: a.user.status });
    }

    return NextResponse.json({
      success: true,
      agency: {
        id:           agency.id.toString(),
        name:         agency.name,
        planType:     agency.planType,
        isActive:     agency.isActive,
        trialEndsAt:  agency.trialEndsAt?.toISOString() ?? null,
        subscribedAt: agency.subscribedAt?.toISOString() ?? null,
        nextBillingAt:agency.nextBillingAt?.toISOString() ?? null,
        maxWorkers:   agency.maxWorkers,
        maxSites:     agency.maxSites,
        createdAt:    agency.createdAt.toISOString(),
      },
      managers: managers.map(m => ({
        id: m.id.toString(), loginId: m.loginId, displayName: m.displayName,
        isActive: m.isActive, lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
      })),
      sites: sites.map(s => ({ id: s.id.toString(), companyName: s.companyName, traineeCount: s.trainees.length })),
      workers: [...uniqueWorkers.values()],
      stats: { logCount, attCount, apiUsage: apiUsage.map(u => ({ service: u.service, count: u._count.id })) },
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
