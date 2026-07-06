// app/api/worker/logs/batch-save/route.ts
// 일지 초안 일괄 저장 API
// 날짜별 DailyAttendance가 없으면 자동 생성(소급 입력 지원)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { WorkStatus } from "@prisma/client";
import { audit } from "@/lib/audit";
import { findTraineeAtSiteInPeriod } from "@/lib/docs/traineeSiteGuard";

interface LogEntry {
  date: string;
  traineeId: string;
  trainingType?: string;
  time1on1?: number;
  timeGroup?: number;
  content?: string;
  evaluation?: string;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const { assignmentId, logs }: { assignmentId: string; logs: LogEntry[] } = body;

    if (!assignmentId || !Array.isArray(logs) || logs.length === 0) {
      return NextResponse.json({ success: false, message: "assignmentId와 logs가 필요합니다." }, { status: 400 });
    }

    const writerId = BigInt(session.workerId);
    const assignId = BigInt(assignmentId);

    // 배정 정보 조회 (siteId, workerId 확인)
    const assignment = await prisma.siteAssignment.findUnique({
      where: { id: assignId },
      select: { workerId: true, siteId: true },
    });
    if (!assignment || assignment.workerId !== writerId) {
      return NextResponse.json({ success: false, message: "배정 정보를 찾을 수 없습니다." }, { status: 403 });
    }

    const { siteId } = assignment;

    // IDOR 방지: 임의 traineeId 주입 차단 — 이 현장·기간에 재적한 훈련생만 허용.
    const allDates = logs.map(l => l.date).filter(Boolean).sort();
    const minDate = allDates[0], maxDate = allDates[allDates.length - 1];
    const uniqueTraineeIds = [...new Set(logs.map(l => String(l.traineeId)))];
    for (const tid of uniqueTraineeIds) {
      if (!/^[0-9]+$/.test(tid)) {
        return NextResponse.json({ success: false, message: "잘못된 훈련생 정보입니다." }, { status: 400 });
      }
      const ok = await findTraineeAtSiteInPeriod(BigInt(tid), siteId, minDate, maxDate);
      if (!ok) {
        return NextResponse.json({ success: false, message: "이 현장에 배정되지 않은 훈련생이 포함되어 있습니다." }, { status: 403 });
      }
    }

    // 고유 날짜 목록 추출
    const uniqueDates = [...new Set(logs.map(l => l.date))];

    // 날짜별 attendanceId 확보 (없으면 생성)
    const dateToAttendanceId = new Map<string, bigint>();
    for (const date of uniqueDates) {
      const existing = await prisma.dailyAttendance.findUnique({
        where: { assignmentId_workDate: { assignmentId: assignId, workDate: date } },
        select: { id: true },
      });
      if (existing) {
        dateToAttendanceId.set(date, existing.id);
      } else {
        // 오늘 날짜는 clock-in 없이 생성 불가 — 스킵
        const todayKST = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        if (date >= todayKST) continue;

        // 과거 날짜: 소급 일지 입력용 출근기록 생성. ★출퇴근 시각이 없으므로 최종확정하지 않는다(isFinalClosed:false).
        //  (시각 0분인 채 확정하면 급여 엔진이 DAILY/MONTHLY 근무일수로 세어 과지급됨 — 시각은 출퇴근 기록/보정으로 채워져야 함.)
        const created = await prisma.dailyAttendance.create({
          data: {
            workerId: writerId,
            siteId,
            assignmentId: assignId,
            workDate: date,
            status: WorkStatus.DONE,
            isFinalClosed: false,
          },
          select: { id: true },
        });
        dateToAttendanceId.set(date, created.id);
      }
    }

    let saved = 0;
    for (const entry of logs) {
      const attendanceId = dateToAttendanceId.get(entry.date);
      if (!attendanceId) continue;

      const traineeId = BigInt(entry.traineeId);
      const logData = {
        traineeId,
        attendanceId,
        writerId,
        trainingType: entry.trainingType || "FIELD",
        time1on1:     Number(entry.time1on1  ?? 0),
        timeGroup:    Number(entry.timeGroup ?? 0),
        content:      entry.content?.trim() || null,
        evaluation:   entry.evaluation || null,
        isCompleted:  true,
      };

      const existing = await prisma.traineeLog.findFirst({
        where: { traineeId, attendanceId },
        select: { id: true },
      });

      if (existing) {
        await prisma.traineeLog.update({ where: { id: existing.id }, data: logData });
      } else {
        await prisma.traineeLog.create({ data: logData });
      }
      saved++;
    }

    if (saved > 0) {
      await audit(session, { entityType: "TraineeLog", action: "createMany", summary: `일지 일괄 저장 ${saved}건` });
    }

    return NextResponse.json({ success: true, saved });
  } catch (error: any) {
    console.error("[worker/logs/batch-save]", error);
    return NextResponse.json({ success: false, message: error.message || "서버 오류" }, { status: 500 });
  }
}
