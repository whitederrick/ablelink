// app/api/worker/calendar/route.ts
// 월별 출근/일지 현황 조회 API (캘린더용)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { getKrHolidays } from "@/lib/krHolidays";

function pad2(n: number) { return String(n).padStart(2, "0"); }

type DayStatus = "GREEN" | "ORANGE" | "RED" | "NONE" | "HOLIDAY";

function calcStatus(opts: {
  hasStart: boolean;
  hasEnd: boolean;
  isFinalClosed: boolean;
  completedLogs: number;
  traineeCount: number;
  isGpsModified: boolean;
}): DayStatus {
  const { hasStart, isFinalClosed, completedLogs, traineeCount, isGpsModified } = opts;

  if (!hasStart) return "RED";

  if (traineeCount > 0) {
    // 훈련생 있음: 모든 훈련생 일지 완료 + 종료되면 GREEN
    return completedLogs >= traineeCount && isFinalClosed ? "GREEN" : "ORANGE";
  } else {
    // 훈련생 없음: 출근 종료 + GPS 이탈 없음이면 GREEN
    return isFinalClosed && !isGpsModified ? "GREEN" : "ORANGE";
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year  = Number(searchParams.get("year")  ?? new Date().getFullYear());
    const month = Number(searchParams.get("month") ?? new Date().getMonth() + 1);

    const workerId = BigInt(session.workerId);

    const startDate = `${year}-${pad2(month)}-01`;
    const endDay    = new Date(year, month, 0).getDate();
    const endDate   = `${year}-${pad2(month)}-${pad2(endDay)}`;

    // 현재 활성 배정 조회
    const assignment = await prisma.siteAssignment.findFirst({
      where: { workerId, status: "ACTIVE" },
      include: { site: true },
      orderBy: { startDate: "desc" },
    });

    // 해당 월 출근 기록 조회
    const attendances = await prisma.dailyAttendance.findMany({
      where: { workerId, workDate: { gte: startDate, lte: endDate } },
      include: { logs: { select: { id: true, isCompleted: true } } },
      orderBy: { workDate: "asc" },
    });

    // 휴무일 조회 (공휴일 + 사이트별 커스텀)
    const nationalHolidays = getKrHolidays(year, month);
    const customHolidayRows = assignment
      ? await prisma.siteHoliday.findMany({
          where: { assignmentId: assignment.id, date: { gte: startDate, lte: endDate } },
          select: { date: true, reason: true },
        })
      : [];
    const customHolidays: Record<string, string> = {};
    for (const r of customHolidayRows) customHolidays[r.date] = r.reason ?? "휴무";

    // 훈련생 수
    const traineeCount = assignment
      ? await prisma.trainee.count({
          where: { currentSiteId: assignment.siteId, status: "TRAINING" },
        })
      : 0;

    // 오늘 날짜 문자열 (KST)
    const nowKst   = new Date(Date.now() + 9 * 3600000);
    const todayStr = nowKst.toISOString().slice(0, 10);

    // 날짜별 상태 맵
    type DayEntry = {
      status: DayStatus;
      attendanceId: string;
      startTime: string | null;
      endTime: string | null;
      isFinalClosed: boolean;
      logCount: number;
      traineeCount: number;
      holidayName?: string;
    };
    const dayMap: Record<string, DayEntry> = {};

    // 출근 기록이 있는 날 처리
    for (const att of attendances) {
      const completedLogs = att.logs.filter(l => l.isCompleted).length;
      dayMap[att.workDate] = {
        status: calcStatus({
          hasStart:       !!att.startTime,
          hasEnd:         !!att.endTime,
          isFinalClosed:  att.isFinalClosed,
          completedLogs,
          traineeCount,
          isGpsModified:  att.isGpsModified,
        }),
        attendanceId: att.id.toString(),
        startTime:    att.startTime?.toISOString() ?? null,
        endTime:      att.endTime?.toISOString()   ?? null,
        isFinalClosed: att.isFinalClosed,
        logCount:     completedLogs,
        traineeCount,
      };
    }

    // 공휴일 + 커스텀 휴무일 처리
    const allHolidays = { ...nationalHolidays, ...customHolidays };
    for (const [date, name] of Object.entries(allHolidays)) {
      if (date >= startDate && date <= endDate && !dayMap[date]) {
        dayMap[date] = {
          status: "HOLIDAY",
          attendanceId: "",
          startTime: null,
          endTime: null,
          isFinalClosed: false,
          logCount: 0,
          traineeCount,
          holidayName: name,
        };
      } else if (dayMap[date]) {
        // 출근 기록이 있어도 휴무일 이름은 표시
        (dayMap[date] as any).holidayName = name;
      }
    }

    // 배정 기간 내 + 오늘 이전 날짜 중 출근 기록 없는 날 → RED
    if (assignment) {
      const assignStart = assignment.startDate.toISOString().slice(0, 10);
      const assignEnd   = assignment.endDate
        ? assignment.endDate.toISOString().slice(0, 10)
        : todayStr;

      // 이 월에서 실제로 RED 처리할 범위
      const redFrom = assignStart > startDate ? assignStart : startDate;
      const redTo   = assignEnd   < todayStr  ? assignEnd   : todayStr; // 오늘 포함, 미래 제외

      // 날짜 순회
      const cur = new Date(redFrom + "T00:00:00");
      const end = new Date(redTo   + "T00:00:00");
      while (cur <= end) {
        const key = cur.toISOString().slice(0, 10);
        // 해당 월 범위 내이고 아직 dayMap에 없는 날짜만 RED로 (휴무일 제외)
        if (key >= startDate && key <= endDate && !dayMap[key] && !allHolidays[key]) {
          dayMap[key] = {
            status:        "RED",
            attendanceId:  "",
            startTime:     null,
            endTime:       null,
            isFinalClosed: false,
            logCount:      0,
            traineeCount,
          };
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    const allDays = Object.values(dayMap);
    const totalWorkDays   = allDays.filter(d => d.startTime).length;
    const totalGreenDays  = allDays.filter(d => d.status === "GREEN").length;
    const totalOrangeDays = allDays.filter(d => d.status === "ORANGE").length;
    const totalRedDays    = allDays.filter(d => d.status === "RED").length;

    const totalHolidayDays = Object.values(dayMap).filter(d => d.status === "HOLIDAY").length;

    return NextResponse.json({
      success: true,
      data: {
        year, month,
        siteName:        assignment?.site?.companyName ?? null,
        assignmentStart: assignment?.startDate?.toISOString().slice(0, 10) ?? null,
        assignmentEnd:   assignment?.endDate?.toISOString().slice(0, 10)   ?? null,
        trainingType: assignment?.serviceStep === "PRE_TRAINING" ? "PRE"
          : assignment?.serviceStep === "ADAPTATION" ? "ADAPTATION" : "FIELD",
        days: dayMap,
        holidays: allHolidays,
        customHolidays,
        totalWorkDays,
        totalGreenDays,
        totalOrangeDays,
        totalRedDays,
        totalHolidayDays,
      },
    });
  } catch (error: any) {
    console.error("[worker/calendar]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
