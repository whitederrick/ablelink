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
      logId,      // 수정 모드: 있으면 해당 일지를 logDate의 출근기록으로 이동(날짜 이동) 가능
    } = body;

    if (!traineeId) {
      return NextResponse.json({ success: false, message: "traineeId는 필수입니다." }, { status: 400 });
    }

    const writerId = BigInt(session.workerId);

    // 날짜 기준 출근기록 조회/생성 (없으면 현장 배정 기반 생성)
    async function findOrCreateAttendance(workDate: string): Promise<bigint> {
      const ex = await prisma.dailyAttendance.findFirst({
        where: { workerId: writerId, workDate },
        orderBy: { id: "desc" },
      });
      if (ex) return ex.id;
      if (!siteId || !assignmentIdFromBody) {
        throw new Error("VALIDATION:출근 기록이 없습니다. 출근 체크인 후 일지를 작성해주세요.");
      }
      const created = await prisma.dailyAttendance.create({
        data: { workerId: writerId, siteId: BigInt(siteId), assignmentId: BigInt(assignmentIdFromBody), workDate },
      });
      return created.id;
    }

    // attendanceId 해석:
    // - 수정 모드(logId): logDate 기준으로 결정 → 날짜를 바꾸면 그 날짜 출근기록으로 이동
    // - 신규(출근에서 진입): attendanceId 직접 사용 / 자유작성: logDate 기준
    let resolvedAttendanceId: bigint;
    const workDate = logDate || new Date().toISOString().slice(0, 10);
    try {
      if (logId) {
        resolvedAttendanceId = await findOrCreateAttendance(workDate);
      } else if (attendanceId) {
        resolvedAttendanceId = BigInt(attendanceId);
      } else {
        resolvedAttendanceId = await findOrCreateAttendance(workDate);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.startsWith("VALIDATION:")) return NextResponse.json({ success: false, message: msg.slice(11) }, { status: 400 });
      throw e;
    }

    // 수정 모드: 소유권 + 날짜 이동 충돌 검사
    if (logId) {
      const own = await prisma.traineeLog.findUnique({ where: { id: BigInt(logId) }, select: { writerId: true } });
      if (!own) return NextResponse.json({ success: false, message: "일지를 찾을 수 없습니다." }, { status: 404 });
      if (own.writerId !== writerId) return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
      const conflict = await prisma.traineeLog.findFirst({
        where: { traineeId: BigInt(traineeId), attendanceId: resolvedAttendanceId, id: { not: BigInt(logId) } },
        select: { id: true },
      });
      if (conflict) return NextResponse.json({ success: false, message: "선택한 날짜에 이미 해당 훈련생의 일지가 있습니다." }, { status: 409 });
    }

    // 수정 모드면 그 일지(logId)를, 아니면 (traineeId, 출근기록) 기준으로 upsert
    const existing = logId
      ? await prisma.traineeLog.findUnique({ where: { id: BigInt(logId) } })
      : await prisma.traineeLog.findFirst({ where: { traineeId: BigInt(traineeId), attendanceId: resolvedAttendanceId } });

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
