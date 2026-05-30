// app/api/worker/logs/batch-save/route.ts
// 일지 초안 일괄 저장 API
// 날짜별 DailyAttendance가 없으면 자동 생성(소급 입력 지원)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";
import { WorkStatus } from "@prisma/client";

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

        // 과거 날짜: 소급 입력 → DONE + 최종확정 상태로 생성
        const created = await prisma.dailyAttendance.create({
          data: {
            workerId: writerId,
            siteId,
            assignmentId: assignId,
            workDate: date,
            status: WorkStatus.DONE,
            isFinalClosed: true,
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

    return NextResponse.json({ success: true, saved });
  } catch (error: any) {
    console.error("[worker/logs/batch-save]", error);
    return NextResponse.json({ success: false, message: error.message || "서버 오류" }, { status: 500 });
  }
}
