// app/api/worker/logs/save/route.ts
// 업무일지 저장 API
// 🔐 보안: 세션 기반 writerId 주입, planGuard 미적용 (저장 자체는 FREE도 가능)

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
      time1on1, timeGroup, extTime1on1, extTimeGroup,
      totalRecognizedTime, content, taskScore,
      completionRate, isCompleted,
    } = body;

    if (!traineeId || !attendanceId) {
      return NextResponse.json({ success: false, message: "traineeId, attendanceId는 필수입니다." }, { status: 400 });
    }

    const writerId = BigInt(session.userId);

    // 기존 로그가 있으면 업데이트, 없으면 생성 (upsert 패턴)
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
      evaluation: completionRate ? String(completionRate) : null,
      isCompleted: isCompleted === true,
    };

    let log;
    if (existing) {
      log = await prisma.traineeLog.update({
        where: { id: existing.id },
        data: logData,
      });
    } else {
      log = await prisma.traineeLog.create({ data: logData });
    }

    // 과제 점수 저장 (기존 삭제 후 재생성)
    if (taskScore) {
      await prisma.traineeLogTask.deleteMany({ where: { logId: log.id } });
      await prisma.traineeLogTask.create({
        data: {
          logId: log.id,
          taskName: "과제 수행 평가",
          performanceScore: Number(taskScore),
        },
      });
    }

    return NextResponse.json({ success: true, logId: log.id.toString() });
  } catch (error: any) {
    console.error("[worker/logs/save]", error);
    return NextResponse.json(
      { success: false, message: error.message || "서버 오류" },
      { status: 500 }
    );
  }
}
