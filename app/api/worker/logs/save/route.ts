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
      attendance,           // 출결 상태 (출석/결석/지각/조퇴)
      time1on1, timeGroup, extTime1on1, extTimeGroup,
      totalRecognizedTime,
      taskName,             // 수행과제명
      taskScore,            // 수행정도 1-5
      measurementTime,      // 측정시간 (e.g. "2.0")
      specialNotes,         // 특이사항 (ADAPTATION 전용)
      content,              // 지도사항 / 평가 및 지도사항
      isCompleted,
    } = body;

    if (!traineeId || !attendanceId) {
      return NextResponse.json({ success: false, message: "traineeId, attendanceId는 필수입니다." }, { status: 400 });
    }

    const writerId = BigInt(session.userId);

    const existing = await prisma.traineeLog.findFirst({
      where: {
        traineeId: BigInt(traineeId),
        attendanceId: BigInt(attendanceId),
      },
    });

    const logData = {
      traineeId: BigInt(traineeId),
      attendanceId: BigInt(attendanceId),
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
