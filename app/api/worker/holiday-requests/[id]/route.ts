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
    class HolidayGone extends Error {}
    try {
      if (action === "accept") {
        await prisma.$transaction(async (tx) => {
          const claim = await tx.siteHolidayRequest.updateMany({ where: { id: reqId, status: "PENDING" }, data: { status: "ACCEPTED" } });
          if (claim.count === 0) throw new AlreadyDone();
          // ★E-5 경합: 대상 SiteHoliday가 매니저의 삭제(또는 worker/holidays DELETE)로 이미 사라졌을 수 있다.
          //  delete/update는 대상이 없으면 P2025를 던져 아래 catch에서 500(서버 오류)이 됐다 — 데이터 훼손이
          //  없는 순수 경합이라 500은 부정확하다. deleteMany/updateMany는 0건이어도 예외를 던지지 않으므로
          //  P2025 자체가 발생하지 않고, 결과 건수로 의미를 나눠 응답한다.
          if (request.requestType === "DELETE") {
            // 삭제 요청 수락: 이미 삭제됐어도 '휴무일이 없다'는 목표 상태가 달성된 것 → 멱등 성공.
            await tx.siteHoliday.deleteMany({ where: { id: request.holidayId } });
          } else if (request.requestType === "CHANGE_WORKDAY") {
            // 근무인정 변경 수락: 대상이 없으면 적용할 것이 없다(목표 상태 미달성) → 409로 알린다.
            //  트랜잭션이 롤백되며 claim도 되돌아가지만, 휴무일이 사라졌으므로 요청 자체가 무의미해진 상태다.
            const upd = await tx.siteHoliday.updateMany({
              where: { id: request.holidayId },
              data: { countAsWorkday: request.proposedCountAsWorkday ?? false },
            });
            if (upd.count === 0) throw new HolidayGone();
          }
        });
      } else {
        const claim = await prisma.siteHolidayRequest.updateMany({ where: { id: reqId, status: "PENDING" }, data: { status: "REJECTED" } });
        if (claim.count === 0) throw new AlreadyDone();
      }
    } catch (e) {
      if (e instanceof AlreadyDone) return NextResponse.json({ success: false, message: "이미 처리된 요청입니다." }, { status: 409 });
      if (e instanceof HolidayGone) return NextResponse.json({ success: false, message: "대상 휴무일이 이미 삭제되어 변경을 적용할 수 없습니다." }, { status: 409 });
      throw e;
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    // 알려진 경합(AlreadyDone·HolidayGone)은 위에서 409로 처리된다. 여기 도달하는 500은 진짜 결함이므로
    //  원인을 삼키지 말고 로그에 남긴다(기존에는 무로깅이라 운영 진단이 불가능했다).
    console.error("[worker/holiday-requests/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
