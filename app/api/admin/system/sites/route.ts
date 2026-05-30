// 시스템 운영자 전용: 전체 현장 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    const sites = await prisma.site.findMany({
      where: q ? { companyName: { contains: q } } : undefined,
      include: {
        agency: { select: { id: true, name: true, planType: true } },
        trainees: { where: { status: "TRAINING" }, select: { id: true } },
        assignments: {
          where: { status: { in: ["ACTIVE", "ASSIGNED", "CONFIRMED"] } },
          include: { user: { select: { id: true, userName: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });

    return NextResponse.json({
      success: true,
      sites: sites.map(s => ({
        id:          s.id.toString(),
        companyName: s.companyName,
        address:     s.address ?? "",
        agencyId:    s.agency?.id?.toString() ?? null,
        agencyName:  s.agency?.name ?? null,
        planType:    s.agency?.planType ?? null,
        traineeCount: s.trainees.length,
        workerCount:   s.assignments.length,
        workers:      s.assignments.map(a => ({ id: a.user.id.toString(), name: a.user.userName })),
        createdAt:   (s as any).createdAt?.toISOString() ?? null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
