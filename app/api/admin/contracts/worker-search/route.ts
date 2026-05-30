// app/api/admin/contracts/worker-search/route.ts
// 근로계약 이력 기준 직무지도원 검색

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (q.length < 2 || q.length > 100) {
      return NextResponse.json({ success: true, items: [] });
    }

    const contractFilter = { some: { agencyId: scope.agencyId } };

    const users = await prisma.worker.findMany({
      where: {
        AND: [
          { employmentContracts: contractFilter },
          {
            OR: [
              { userName: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q } },
            ],
          },
        ],
      },
      include: {
        employmentContracts: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            siteName: true,
            workerFilledSiteName: true,
            contractStart: true,
            contractEnd: true,
          },
        },
      },
      take: 20,
    });

    return NextResponse.json({
      success: true,
      items: users.map(u => {
        const latest = u.employmentContracts[0];
        const siteName = latest?.siteName || latest?.workerFilledSiteName || null;
        return {
          id: String(u.id),
          userName: u.userName,
          phoneNumber: u.phoneNumber,
          email: u.loginId,
          siteName,
          contractStart: latest?.contractStart?.toISOString() ?? null,
          contractEnd: latest?.contractEnd?.toISOString() ?? null,
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json(
      { success: false, message: e?.message ?? "UNKNOWN" },
      { status: 500 }
    );
  }
}
