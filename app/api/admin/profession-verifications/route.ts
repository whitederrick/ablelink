// app/api/admin/profession-verifications/route.ts
// 시스템 운영자(공단/플랫폼) — 직종 자격 증빙 검증 목록
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

const STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
const PROFS = ["JOB_COACH", "CAREGIVER", "ACTIVITY_ASSISTANT"] as const;

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "PENDING";
    const profession = searchParams.get("profession") || "";
    const q = (searchParams.get("q") || "").trim();

    const where: any = {};
    if (STATUSES.includes(status as any)) where.verifyStatus = status;
    if (PROFS.includes(profession as any)) where.profession = profession;
    if (q) where.worker = { OR: [{ workerName: { contains: q, mode: "insensitive" } }, { phoneNumber: { contains: q } }] };

    const rows = await prisma.workerProfession.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: 200,
      include: { worker: { select: { id: true, workerName: true, phoneNumber: true, residenceAddress: true, bio: true } } },
    });

    // 상태별 카운트(대시보드 배지용)
    const counts = await prisma.workerProfession.groupBy({ by: ["verifyStatus"], _count: true });
    const countMap: Record<string, number> = { PENDING: 0, VERIFIED: 0, REJECTED: 0 };
    for (const c of counts) countMap[c.verifyStatus] = c._count;

    return NextResponse.json({
      success: true,
      counts: countMap,
      items: rows.map((r) => ({
        id: r.id.toString(),
        profession: r.profession,
        certNumber: r.certNumber ?? null,
        experienceYears: r.experienceYears,
        verifyStatus: r.verifyStatus,
        createdAt: r.createdAt.toISOString(),
        verifiedAt: r.verifiedAt?.toISOString() ?? null,
        worker: {
          id: r.worker.id.toString(),
          name: r.worker.workerName,
          phoneNumber: r.worker.phoneNumber,
          residenceAddress: r.worker.residenceAddress ?? null,
          bio: r.worker.bio ?? null,
        },
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/profession-verifications GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
