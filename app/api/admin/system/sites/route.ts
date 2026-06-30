// 시스템 운영자 전용: 전체 현장 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    const where = q ? { companyName: { contains: q } } : undefined;
    // 목록 take 300 제한과 별개로, 상단 카드/칩은 전체 기준 count 사용.
    const [sites, total, linked] = await Promise.all([
     prisma.site.findMany({
      where,
      include: {
        agency: { select: { id: true, name: true, planType: true } },
        ownerManager: { select: { displayName: true, loginId: true } },
        trainees: { where: { status: "TRAINING" }, select: { id: true } },
        assignments: {
          where: { status: { in: ["ACTIVE", "ASSIGNED", "CONFIRMED"] } },
          include: { user: { select: { id: true, workerName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
     }),
      prisma.site.count({ where }),
      prisma.site.count({ where: { ...(where ?? {}), agencyId: { not: null } } }),
    ]);
    const counts = { total, linked };

    return NextResponse.json({
      success: true,
      counts,
      sites: sites.map(s => ({
        id:          s.id.toString(),
        companyName: s.companyName,
        address:     s.address ?? "",
        requiredProfession: s.requiredProfession ?? null,
        agencyId:    s.agency?.id?.toString() ?? null,
        agencyName:  s.agency?.name ?? null,
        planType:    s.agency?.planType ?? null,
        businessContactName:  (s as any).businessContactName ?? null,
        businessContactPhone: (s as any).businessContactPhone ?? null,
        ownerManagerName:     s.ownerManager?.displayName ?? s.ownerManager?.loginId ?? null,
        allowanceRange:       (s as any).allowanceRange ?? null,
        basePointConfirmed:   (s as any).basePointConfirmed ?? false,
        basePointApprovalStatus: (s as any).basePointApprovalStatus ?? null,
        traineeCount: s.trainees.length,
        workerCount:   s.assignments.length,
        workers:      s.assignments.map(a => ({ id: a.user.id.toString(), name: a.user.workerName })),
        isActive:    (s as any).isActive ?? true,
        createdAt:   (s as any).createdAt?.toISOString() ?? null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
