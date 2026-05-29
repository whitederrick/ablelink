// 매니저 최종 확정/잠금
// POST   — 잠금: 특정 userId+yearMonth의 출근기록 전체 isManagerFinalClosed=true
// DELETE — 잠금 해제
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope, parseBigInt } from "@/lib/adminScope";

function dateRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  return {
    dateFrom: `${yearMonth}-01`,
    dateTo:   `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const scope    = await requireAdminSession(req);
    if (scope.role !== "AGENCY") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    const agencyId = requireAgencyScope(scope);

    const { userId, yearMonth } = await req.json();
    if (!userId || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "userId와 yearMonth(YYYY-MM)가 필요합니다." }, { status: 400 });

    const userBigId = parseBigInt(userId);
    if (!userBigId) return NextResponse.json({ success: false, message: "잘못된 userId입니다." }, { status: 400 });

    // 해당 직무지도원이 자기 에이전시 소속인지 확인
    // assignmentId로 스코프를 제한해 다중배정 시 타 에이전시 레코드 침범 방지
    const assignments = await prisma.siteAssignment.findMany({
      where: { userId: userBigId, agencyId, status: { in: ["ACTIVE","ASSIGNED","CONFIRMED"] } },
      select: { id: true },
    });
    if (assignments.length === 0)
      return NextResponse.json({ success: false, message: "해당 직무지도원은 이 에이전시 소속이 아닙니다." }, { status: 403 });

    const assignmentIds = assignments.map(a => a.id);
    const { dateFrom, dateTo } = dateRange(yearMonth);
    const now = new Date();

    const result = await prisma.dailyAttendance.updateMany({
      where: {
        assignmentId: { in: assignmentIds },
        workDate:     { gte: dateFrom, lte: dateTo },
        startTime:    { not: null },
      },
      data: {
        isManagerFinalClosed: true,
        managerFinalAt:       now,
        managerFinalBy:       scope.userId,
      },
    });

    // WorkerNotice 알림
    await prisma.workerNotice.create({
      data: {
        userId:   userBigId,
        agencyId,
        title:    `[최종 확정] ${yearMonth} 출근기록이 잠겼습니다`,
        body:     `에이전시 관리자가 ${yearMonth} 출근기록을 최종 확정했습니다. 더 이상 수정이 불가합니다.`,
        type:     "INFO",
      },
    });

    return NextResponse.json({ success: true, locked: result.count });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const scope    = await requireAdminSession(req);
    if (scope.role !== "AGENCY") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    const agencyId = requireAgencyScope(scope);

    const { userId, yearMonth } = await req.json();
    if (!userId || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "userId와 yearMonth(YYYY-MM)가 필요합니다." }, { status: 400 });

    const userBigId = parseBigInt(userId);
    if (!userBigId) return NextResponse.json({ success: false, message: "잘못된 userId입니다." }, { status: 400 });

    const assignments = await prisma.siteAssignment.findMany({
      where: { userId: userBigId, agencyId, status: { in: ["ACTIVE","ASSIGNED","CONFIRMED"] } },
      select: { id: true },
    });
    if (assignments.length === 0)
      return NextResponse.json({ success: false, message: "해당 직무지도원은 이 에이전시 소속이 아닙니다." }, { status: 403 });

    const assignmentIds = assignments.map(a => a.id);
    const { dateFrom, dateTo } = dateRange(yearMonth);

    const result = await prisma.dailyAttendance.updateMany({
      where: {
        assignmentId:         { in: assignmentIds },
        workDate:             { gte: dateFrom, lte: dateTo },
        isManagerFinalClosed: true,
      },
      data: {
        isManagerFinalClosed: false,
        managerFinalAt:       null,
        managerFinalBy:       null,
      },
    });

    return NextResponse.json({ success: true, unlocked: result.count });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
