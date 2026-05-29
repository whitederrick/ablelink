// 직무지도원: 휴무일 변경 요청 수락/거절
// PATCH /api/worker/holiday-requests/[id]  { action: "accept" | "reject" }
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

function safeBigInt(v: string): bigint | null {
  try { return BigInt(v); } catch { return null; }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const reqId = safeBigInt(id);
    if (!reqId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const { action } = await req.json();
    if (!["accept", "reject"].includes(action))
      return NextResponse.json({ success: false, message: "잘못된 액션입니다." }, { status: 400 });

    const request = await prisma.siteHolidayRequest.findUnique({
      where: { id: reqId },
      include: {
        holiday: {
          include: { assignment: { select: { userId: true } } },
        },
      },
    });

    if (!request) return NextResponse.json({ success: false, message: "요청을 찾을 수 없습니다." }, { status: 404 });
    if (request.holiday.assignment.userId !== BigInt(session.userId))
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (request.status !== "PENDING")
      return NextResponse.json({ success: false, message: "이미 처리된 요청입니다." }, { status: 409 });

    if (action === "accept") {
      // 트랜잭션: 요청 수락 + 실제 휴무일 변경 적용
      await prisma.$transaction(async (tx) => {
        await tx.siteHolidayRequest.update({
          where: { id: reqId },
          data: { status: "ACCEPTED" },
        });

        if (request.requestType === "DELETE") {
          await tx.siteHoliday.delete({ where: { id: request.holidayId } });
        } else if (request.requestType === "CHANGE_WORKDAY") {
          await tx.siteHoliday.update({
            where: { id: request.holidayId },
            data: { countAsWorkday: request.proposedCountAsWorkday ?? false },
          });
        }
      });
    } else {
      await prisma.siteHolidayRequest.update({
        where: { id: BigInt(id) },
        data: { status: "REJECTED" },
      });
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
