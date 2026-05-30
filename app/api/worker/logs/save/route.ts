// app/api/worker/logs/save/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const {
      traineeId, attendanceId, trainingType,
      attendance,
      time1on1, timeGroup, extTime1on1, extTimeGroup,
      totalRecognizedTime,
      taskName,
      taskScore,
      measurementTime,
      specialNotes,
      content,
      isCompleted,
      logDate,    // attendanceId 없을 때 날짜 기준 조회/생성용
      siteId,     // 출근 기록 자동 생성 시 필요
      assignmentId: assignmentIdFromBody,
    } = body;

    if (!traineeId) {
      return NextResponse.json({ success: false, message: "traineeId는 필수입니다." }, { status: 400 });
    }

    const writerId = BigInt(session.workerId);

    // attendanceId 해석: 직접 전달받거나, logDate 기준으로 조회/생성
    let resolvedAttendanceId: bigint;
    if (attendanceId) {
      resolvedAttendanceId = BigInt(attendanceId);
    } else {
      const workDate = logDate || new Date().toISOString().slice(0, 10);
      const existing = await prisma.dailyAttendance.findFirst({
        where: { workerId: writerId, workDate },
        orderBy: { id: "desc" },
      });
      if (existing) {
        resolvedAttendanceId = existing.id;
      } else {
        // 출근 기록 없으면 자동 생성 (현장 배정 기반)
        if (!siteId || !assignmentIdFromBody) {
          return NextResponse.json({ success: false, message: "출근 기록이 없습니다. 출근 체크인 후 일지를 작성해주세요." }, { status: 400 });
        }
        const created = await prisma.dailyAttendance.create({
          data: {
            workerId: writerId,
            siteId: BigInt(siteId),
            assignmentId: BigInt(assignmentIdFromBody),
            workDate,
          },
        });
        resolvedAttendanceId = created.id;
      }
    }

    const existing = await prisma.traineeLog.findFirst({
      where: {
        traineeId: BigInt(traineeId),
        attendanceId: resolvedAttendanceId,
      },
    });

    const logData = {
      traineeId: BigInt(traineeId),
      attendanceId: resolvedAttendanceId,
      writerId,
      trainingType: trainingType || "FIELD",
      time1on1: Number(time1on1 ?? 0),
      timeGroup: Number(timeGroup ?? 0),
      extTime1on1: Number(extTime1on1 ?? 0),
      extTimeGroup: Number(extTimeGroup ?? 0),
      totalRecognizedTime: Number(totalRecognizedTime ?? 0),
      content: content?.trim() || null,
      evaluation: attendance || "출석",  // 출결 상태 저장 (기존 completionRate 버그 수정)
      isCompleted: isCompleted === true,
    };

    let log;
    if (existing) {
      log = await prisma.traineeLog.update({ where: { id: existing.id }, data: logData });
    } else {
      log = await prisma.traineeLog.create({ data: logData });
    }

    // 과제 정보 저장
    await prisma.traineeLogTask.deleteMany({ where: { logId: log.id } });
    if (taskScore || taskName) {
      await prisma.traineeLogTask.create({
        data: {
          logId: log.id,
          taskName: taskName?.trim() || "수행과제",
          performanceScore: Number(taskScore) || 3,
          difficulty: measurementTime ? String(measurementTime).trim() : null,  // 측정시간
          feedback: specialNotes?.trim() || null,                               // 특이사항
        },
      });
    }

    return NextResponse.json({ success: true, logId: log.id.toString() });
  } catch (error: any) {
    console.error("[worker/logs/save]", error);
    return NextResponse.json({ success: false, message: error.message || "서버 오류" }, { status: 500 });
  }
}
