// app/api/admin/dashboard/route.ts
// 관리자 대시보드 실시간 통계 API

export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const thisMonthStr = thisMonthStart.toISOString().slice(0, 10);

    // 1. 전체 활성 배정 수
    const totalActiveCoaches = await prisma.siteAssignment.count({
      where: { status: "ACTIVE" },
    });

    // 2. 오늘 출근 기록
    const todayAttendances = await prisma.dailyAttendance.findMany({
      where: { workDate: todayStr },
      select: {
        id: true,
        userId: true,
        startTime: true,
        endTime: true,
        isFinalClosed: true,
        isGpsModified: true,
        user: { select: { userName: true } },
        site: { select: { companyName: true } },
        logs: { select: { isCompleted: true } },
        attendanceIssue: { select: { id: true, status: true } },
      },
    });

    const clockedIn = todayAttendances.filter(a => a.startTime).length;
    const clockedOut = todayAttendances.filter(a => a.endTime).length;
    const finalized = todayAttendances.filter(a => a.isFinalClosed).length;
    const logCompleted = todayAttendances.filter(a =>
      a.logs.length > 0 && a.logs.every(l => l.isCompleted)
    ).length;
    const logPending = todayAttendances.filter(a =>
      a.startTime && (a.logs.length === 0 || a.logs.some(l => !l.isCompleted))
    ).length;

    // 3. GPS 이탈 승인 대기 (attendanceIssue 통해 처리)
    const gpsPendingAttendances = todayAttendances.filter(a =>
      a.isGpsModified && a.attendanceIssue && a.attendanceIssue.status === "OPEN"
    );

    // 4. 이번 달 통계
    const monthAttendances = await prisma.dailyAttendance.findMany({
      where: { workDate: { gte: thisMonthStr, lte: todayStr } },
      select: {
        startTime: true,
        logs: { select: { totalRecognizedTime: true, isCompleted: true } },
      },
    });

    const monthWorkDays = monthAttendances.filter(a => a.startTime).length;
    const monthTotalHours = monthAttendances.reduce((sum, a) =>
      sum + a.logs.reduce((s, l) => s + Number(l.totalRecognizedTime || 0), 0), 0
    );
    const monthCompletedDocs = monthAttendances.filter(a =>
      a.logs.length > 0 && a.logs.every(l => l.isCompleted)
    ).length;

    // 5. 이번 달 미제출 훈련생 수 (일지 미완료)
    const monthPendingLogs = monthAttendances.filter(a =>
      a.startTime && a.logs.some(l => !l.isCompleted)
    ).length;

    // 6. 오늘 출근 목록
    const todayList = todayAttendances.map(a => ({
      id: a.id.toString(),
      userName: a.user?.userName || "-",
      siteName: a.site?.companyName || "-",
      clockIn: a.startTime ? formatHHMM(a.startTime) : null,
      clockOut: a.endTime ? formatHHMM(a.endTime) : null,
      isFinalClosed: a.isFinalClosed,
      isGpsModified: a.isGpsModified,
      logStatus: a.logs.length === 0 ? "미작성"
        : a.logs.every(l => l.isCompleted) ? "완료"
        : "임시저장",
    }));

    // 7. GPS 이탈 대기 목록 (전체 기간, OPEN 상태)
    const gpsPendingList = await prisma.dailyAttendance.findMany({
      where: {
        isGpsModified: true,
        attendanceIssue: { status: "OPEN" },
      },
      select: {
        id: true,
        workDate: true,
        user: { select: { userName: true } },
        site: { select: { companyName: true } },
      },
      orderBy: { id: "desc" },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      data: {
        today: todayStr,
        summary: {
          totalActiveCoaches,
          clockedIn,
          clockedOut,
          finalized,
          gpsIssues: gpsPendingAttendances.length,
          logCompleted,
          logPending,
        },
        month: {
          workDays: monthWorkDays,
          totalHours: Math.round(monthTotalHours * 10) / 10,
          completedDocs: monthCompletedDocs,
          pendingLogs: monthPendingLogs,
        },
        gpsPendingList: gpsPendingList.map(g => ({
          id: g.id.toString(),
          userName: g.user?.userName || "-",
          siteName: g.site?.companyName || "-",
          workDate: g.workDate,
        })),
        todayList,
      },
    });
  } catch (error: any) {
    console.error("[admin/dashboard]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

function formatHHMM(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
