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
    const { action } = await req.json().catch(() => ({}));
    if (!["accept", "reject"].includes(action))
      return NextResponse.json({ success: false, message: "잘못된 액션입니다." }, { status: 400 });

    const request = await prisma.siteHolidayRequest.findUnique({
      where: { id: reqId },
      include: {
        holiday: {
          include: { assignment: { select: { workerId: true } } },
        },
      },
    });

    if (!request) return NextResponse.json({ success: false, message: "요청을 찾을 수 없습니다." }, { status: 404 });
    if (request.holiday.assignment.workerId !== BigInt(session.workerId))
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (request.status !== "PENDING")
      return NextResponse.json({ success: false, message: "이미 처리된 요청입니다." }, { status: 409 });

    // ★상태 재확인을 tx 안 조건부 claim으로(TOCTOU): 위 :36 가드는 tx 밖 read라, 워커가 accept/reject를
    //  동시(더블탭)로 보내면 accept가 휴무 변경/삭제를 커밋한 뒤 reject가 status를 덮어 '반려인데 변경은 적용됨'
    //  불일치가 생긴다. 또 이중 accept(DELETE)는 둘째 delete가 P2025로 500. 매니저측 연차 라우트와 동일하게
    //  updateMany({status:PENDING}) claim으로 직렬화, count===0이면 이미 처리됨(409).
    class AlreadyDone extends Error {}
    try {
      if (action === "accept") {
        await prisma.$transaction(async (tx) => {
          const claim = await tx.siteHolidayRequest.updateMany({ where: { id: reqId, status: "PENDING" }, data: { status: "ACCEPTED" } });
          if (claim.count === 0) throw new AlreadyDone();
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
        const claim = await prisma.siteHolidayRequest.updateMany({ where: { id: reqId, status: "PENDING" }, data: { status: "REJECTED" } });
        if (claim.count === 0) throw new AlreadyDone();
      }
    } catch (e) {
      if (e instanceof AlreadyDone) return NextResponse.json({ success: false, message: "이미 처리된 요청입니다." }, { status: 409 });
      throw e;
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
