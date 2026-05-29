// 시스템 운영자 전용: 전체 직무지도원 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() ?? "";

    const users = await prisma.worker.findMany({
      where: q ? {
        OR: [
          { userName: { contains: q } },
          { phoneNumber: { contains: q } },
          { loginId: { contains: q } },
        ],
      } : undefined,
      include: {
        assignments: {
          where: { status: { in: ["ACTIVE", "ASSIGNED", "CONFIRMED"] } },
          include: {
            site: { select: { companyName: true, agency: { select: { id: true, name: true } } } },
          },
          take: 1,
          orderBy: { startDate: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      success: true,
      workers: users.map(u => {
        const asgn = u.assignments[0];
        return {
          id:          u.id.toString(),
          loginId:     u.loginId,
          userName:    u.userName,
          phoneNumber: u.phoneNumber,
          status:      u.status,
          planType:    u.planType,
          siteName:    asgn?.site?.companyName ?? null,
          agencyId:    asgn?.site?.agency?.id?.toString() ?? null,
          agencyName:  asgn?.site?.agency?.name ?? null,
          createdAt:   u.createdAt.toISOString(),
        };
      }),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
