// app/api/admin/contracts/worker-search/route.ts
// 근로계약 이력 기준 직무지도원 검색

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminOrManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    // 듀얼: 운영자=전체 기관 계약 이력, 매니저=본인 기관
    const session = await requireAdminOrManagerSession(req);
    const agencyId = session.kind === "manager" ? session.agencyId : undefined;
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim();

    if (q.length < 2 || q.length > 100) {
      return NextResponse.json({ success: true, items: [] });
    }

    const contractFilter = agencyId ? { some: { agencyId } } : { some: {} };

    const users = await prisma.worker.findMany({
      where: {
        AND: [
          { employmentContracts: contractFilter },
          {
            OR: [
              { workerName: { contains: q, mode: "insensitive" } },
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
          workerName: u.workerName,
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
    console.error("[contracts/worker-search]", e);
    return NextResponse.json(
      { success: false, message: "서버 오류" },
      { status: 500 }
    );
  }
}
