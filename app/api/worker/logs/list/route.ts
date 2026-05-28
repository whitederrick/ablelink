export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const traineeId    = searchParams.get("traineeId");
    const periodStart  = searchParams.get("periodStart");
    const periodEnd    = searchParams.get("periodEnd");
    const trainingType = searchParams.get("trainingType");

    const userId = BigInt(session.userId);

    const logs = await prisma.traineeLog.findMany({
      where: {
        writerId: userId,
        ...(traineeId    ? { traineeId: BigInt(traineeId) } : {}),
        ...(trainingType ? { trainingType } : {}),
        attendance: {
          ...(periodStart && periodEnd
            ? { workDate: { gte: periodStart, lte: periodEnd } }
            : {}),
        },
      },
      include: {
        trainee:    { select: { name: true, gender: true } },
        attendance: { select: { workDate: true } },
        tasks:      true,
      },
      orderBy: { attendance: { workDate: "desc" } },
    });

    return NextResponse.json({
      success: true,
      logs: logs.map(l => ({
        id:              l.id.toString(),
        traineeId:       l.traineeId.toString(),
        attendanceId:    l.attendanceId.toString(),
        traineeName:     l.trainee.name,
        traineeGender:   l.trainee.gender,
        workDate:        l.attendance.workDate,
        trainingType:    l.trainingType,
        attendance:      l.evaluation || "출석",
        totalTime:       Number(l.totalRecognizedTime),
        content:         l.content ?? "",
        taskName:        l.tasks[0]?.taskName ?? "",
        taskScore:       l.tasks[0]?.performanceScore ?? null,
        measurementTime: l.tasks[0]?.difficulty ?? "",
        specialNotes:    l.tasks[0]?.feedback ?? "",
        isCompleted:     l.isCompleted,
      })),
    });
  } catch (e: any) {
    console.error("[logs/list]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
