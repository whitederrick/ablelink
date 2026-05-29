// 커스텀 휴무일 변경 요청
// GET  — AGENCY: 자기 에이전시 직무지도원들의 휴무일 목록 + 기존 요청 현황
// POST — AGENCY: 변경/삭제 요청 생성
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { searchParams } = new URL(req.url);
    const ym = searchParams.get("yearMonth") ?? new Date().toISOString().slice(0, 7);
    const [y, m] = ym.split("-");
    const pad = m.padStart(2, "0");
    const dateFrom = `${y}-${pad}-01`;
    const dateTo   = `${y}-${pad}-31`;

    // 에이전시 소속 활성 배정의 휴무일
    const holidays = await prisma.siteHoliday.findMany({
      where: {
        date: { gte: dateFrom, lte: dateTo },
        assignment: { agencyId, status: { in: ["ACTIVE", "ASSIGNED", "CONFIRMED"] } },
      },
      include: {
        assignment: {
          select: {
            id: true,
            user: { select: { id: true, userName: true } },
            site: { select: { companyName: true } },
          },
        },
        requests: {
          where: { status: "PENDING" },
          select: { id: true, requestType: true, proposedCountAsWorkday: true, reason: true, status: true, createdAt: true },
        },
      },
      orderBy: [{ date: "asc" }],
    });

    return NextResponse.json({
      success: true,
      holidays: holidays.map(h => ({
        id:              h.id.toString(),
        date:            h.date,
        reason:          h.reason ?? null,
        countAsWorkday:  h.countAsWorkday,
        userName:        h.assignment.user.userName,
        userId:          h.assignment.user.id.toString(),
        siteName:        h.assignment.site.companyName,
        assignmentId:    h.assignment.id.toString(),
        pendingRequest:  h.requests[0]
          ? {
              id:                     h.requests[0].id.toString(),
              requestType:            h.requests[0].requestType,
              proposedCountAsWorkday: h.requests[0].proposedCountAsWorkday ?? null,
              reason:                 h.requests[0].reason ?? null,
              status:                 h.requests[0].status,
              createdAt:              h.requests[0].createdAt.toISOString(),
            }
          : null,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { holidayId, requestType, proposedCountAsWorkday, reason } = await req.json();
    if (!holidayId || !["DELETE", "CHANGE_WORKDAY"].includes(requestType))
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });

    if (requestType === "CHANGE_WORKDAY" && proposedCountAsWorkday === undefined)
      return NextResponse.json({ success: false, message: "변경할 근무인정 값이 필요합니다." }, { status: 400 });

    // 해당 휴무일이 자기 에이전시 소속인지 확인
    const holiday = await prisma.siteHoliday.findUnique({
      where: { id: BigInt(holidayId) },
      include: { assignment: { select: { agencyId: true } } },
    });
    if (!holiday || holiday.assignment.agencyId !== agencyId)
      return NextResponse.json({ success: false, message: "접근 권한이 없습니다." }, { status: 403 });

    // 이미 PENDING 요청이 있으면 중복 방지
    const existing = await prisma.siteHolidayRequest.findFirst({
      where: { holidayId: BigInt(holidayId), status: "PENDING" },
    });
    if (existing)
      return NextResponse.json({ success: false, message: "이미 처리 대기 중인 요청이 있습니다." }, { status: 409 });

    const request = await prisma.siteHolidayRequest.create({
      data: {
        holidayId:             BigInt(holidayId),
        agencyId,
        managerId: scope.managerId,
        requestType,
        proposedCountAsWorkday: requestType === "CHANGE_WORKDAY" ? Boolean(proposedCountAsWorkday) : null,
        reason:                reason?.trim() || null,
      },
    });

    // 직무지도원에게 WorkerNotice 알림
    const workerUserId = holiday.assignment
      ? (await prisma.siteAssignment.findUnique({
          where: { id: holiday.assignmentId },
          select: { userId: true },
        }))?.userId
      : null;

    if (workerUserId) {
      const typeLabel = requestType === "DELETE" ? "삭제" : "근무인정 변경";
      await prisma.workerNotice.create({
        data: {
          userId:   workerUserId,
          agencyId,
          title:    `[휴무일 ${typeLabel} 요청] ${holiday.date}`,
          body:     reason?.trim() || `에이전시에서 ${holiday.date} 커스텀 휴무일 ${typeLabel}을 요청했습니다. 캘린더에서 확인해주세요.`,
          type:     "INFO",
        },
      });
    }

    return NextResponse.json({ success: true, id: request.id.toString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
