// 직무지도원: 자기 PENDING 휴무일 변경 요청 목록
// GET /api/worker/holiday-requests
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);

    const requests = await prisma.siteHolidayRequest.findMany({
      where: {
        status: "PENDING",
        holiday: {
          assignment: { workerId },
        },
      },
      include: {
        holiday: { select: { date: true, reason: true, countAsWorkday: true } },
        agency:  { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      requests: requests.map(r => ({
        id:                     r.id.toString(),
        requestType:            r.requestType,
        proposedCountAsWorkday: r.proposedCountAsWorkday ?? null,
        reason:                 r.reason ?? null,
        status:                 r.status,
        agencyName:             r.agency.name,
        date:                   r.holiday.date,
        currentReason:          r.holiday.reason ?? null,
        currentCountAsWorkday:  r.holiday.countAsWorkday,
        createdAt:              r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
