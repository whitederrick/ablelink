// app/api/worker/calendar/route.ts
// 월별 출근/일지 현황 조회 API (캘린더용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year = Number(searchParams.get("year") ?? new Date().getFullYear());
    const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);

    const userId = BigInt(session.userId);

    // 해당 월의 시작~끝 날짜 문자열
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDay = new Date(year, month, 0).getDate(); // 말일
    const endDate = `${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`;

    // 현재 활성 배정 조회
    const assignment = await prisma.siteAssignment.findFirst({
      where: {
        userId,
        status: "ACTIVE",
      },
      include: { site: true },
      orderBy: { startDate: "desc" },
    });

    // 해당 월 출근 기록 전체 조회
    const attendances = await prisma.dailyAttendance.findMany({
      where: {
        userId,
        workDate: { gte: startDate, lte: endDate },
      },
      include: {
        logs: {
          select: { id: true, isCompleted: true, traineeId: true },
        },
      },
      orderBy: { workDate: "asc" },
    });

    // 훈련생 수 파악 (Trainee는 currentSiteId로 Site와 연결)
    const traineeCount = assignment
      ? await prisma.trainee.count({
          where: {
            currentSiteId: assignment.siteId,
            status: "TRAINING",
          },
        })
      : 0;

    // 날짜별 상태 맵 생성
    const dayMap: Record<string, {
      status: "GREEN" | "ORANGE" | "RED" | "NONE";
      startTime: string | null;
      endTime: string | null;
      isFinalClosed: boolean;
      logCount: number;
      traineeCount: number;
    }> = {};

    for (const att of attendances) {
      const completedLogs = att.logs.filter(l => l.isCompleted).length;
      const allLogsCompleted = traineeCount > 0 && completedLogs >= traineeCount;

      let status: "GREEN" | "ORANGE" | "RED" | "NONE";
      if (!att.startTime) {
        status = "RED"; // 출근 기록 없음
      } else if (allLogsCompleted) {
        status = "GREEN"; // 출근 + 일지 모두 완료
      } else {
        status = "ORANGE"; // 출근했지만 일지 미완료
      }

      dayMap[att.workDate] = {
        status,
        startTime: att.startTime?.toISOString() ?? null,
        endTime: att.endTime?.toISOString() ?? null,
        isFinalClosed: att.isFinalClosed,
        logCount: completedLogs,
        traineeCount,
      };
    }

    return NextResponse.json({
      success: true,
      data: {
        year,
        month,
        siteName: assignment?.site?.companyName ?? null,
        assignmentStart: assignment?.startDate?.toISOString().slice(0, 10) ?? null,
        assignmentEnd: assignment?.endDate?.toISOString().slice(0, 10) ?? null,
        days: dayMap,
        totalWorkDays: attendances.filter(a => a.startTime).length,
        totalGreenDays: attendances.filter(a => {
          const completedLogs = a.logs.filter(l => l.isCompleted).length;
          return a.startTime && traineeCount > 0 && completedLogs >= traineeCount;
        }).length,
        totalOrangeDays: attendances.filter(a => {
          const completedLogs = a.logs.filter(l => l.isCompleted).length;
          return a.startTime && !(traineeCount > 0 && completedLogs >= traineeCount);
        }).length,
      },
    });
  } catch (error: any) {
    console.error("[worker/calendar]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
