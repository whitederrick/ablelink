export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const log = await prisma.traineeLog.findUnique({
      where: { id: BigInt(id) },
      include: {
        trainee:    { select: { name: true, gender: true } },
        attendance: { select: { workDate: true } },
        tasks:      true,
      },
    });

    if (!log) return NextResponse.json({ success: false, message: "일지를 찾을 수 없습니다." }, { status: 404 });
    if (log.writerId.toString() !== session.userId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    return NextResponse.json({
      success: true,
      log: {
        id:              log.id.toString(),
        traineeId:       log.traineeId.toString(),
        attendanceId:    log.attendanceId.toString(),
        traineeName:     log.trainee.name,
        traineeGender:   log.trainee.gender,
        workDate:        log.attendance.workDate,
        trainingType:    log.trainingType,
        attendance:      log.evaluation || "출석",
        time1on1:        Number(log.time1on1),
        timeGroup:       Number(log.timeGroup),
        extTime1on1:     Number(log.extTime1on1),
        extTimeGroup:    Number(log.extTimeGroup),
        totalTime:       Number(log.totalRecognizedTime),
        content:         log.content ?? "",
        taskName:        log.tasks[0]?.taskName ?? "",
        taskScore:       log.tasks[0]?.performanceScore ?? 3,
        measurementTime: log.tasks[0]?.difficulty ?? "",
        specialNotes:    log.tasks[0]?.feedback ?? "",
        isCompleted:     log.isCompleted,
      },
    });
  } catch (e: any) {
    console.error("[logs/[id] GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const log = await prisma.traineeLog.findUnique({
      where: { id: BigInt(id) },
      select: { writerId: true, isCompleted: true },
    });

    if (!log) return NextResponse.json({ success: false, message: "일지를 찾을 수 없습니다." }, { status: 404 });
    if (log.writerId.toString() !== session.userId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (typeof body.content !== "string")
      return NextResponse.json({ success: false, message: "content 필드가 필요합니다." }, { status: 400 });

    // 확정된 일지 수정 시 자동 확정 취소 후 저장
    await prisma.traineeLog.update({
      where: { id: BigInt(id) },
      data: { content: body.content, isCompleted: false },
    });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[logs/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const log = await prisma.traineeLog.findUnique({
      where: { id: BigInt(id) },
      select: { writerId: true },
    });

    if (!log) return NextResponse.json({ success: false, message: "일지를 찾을 수 없습니다." }, { status: 404 });
    if (log.writerId.toString() !== session.userId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    await prisma.traineeLog.delete({ where: { id: BigInt(id) } });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[logs/[id] DELETE]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
