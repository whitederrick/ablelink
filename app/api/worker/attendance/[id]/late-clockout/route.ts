// app/api/worker/attendance/[id]/late-clockout/route.ts
// 퇴근 미실행(과거 날짜에 출근만 하고 퇴근을 안 누른 기록)을 직무지도원이 늦게 처리.
// - 사유(사전 선택 코드 + 기타 자유입력)와 함께 표준 퇴근시각을 출근부에 채우고 확정한다.
// - GPS 검증 없음(실시간 퇴근이 아니므로). actualEndTime은 남기지 않고 lateClockOutAt으로 기록.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { isLateClockOutReasonCode } from "@/lib/attendance/lateClockOut";
import { parseBigInt } from "@/lib/adminScope";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) {
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const reasonCode = String(body?.reasonCode ?? "").trim();
    const reasonText = String(body?.reasonText ?? "").trim();

    if (!isLateClockOutReasonCode(reasonCode)) {
      return NextResponse.json({ success: false, message: "사유를 선택해 주세요." }, { status: 400 });
    }
    if (reasonCode === "OTHER" && !reasonText) {
      return NextResponse.json({ success: false, message: "기타 사유를 입력해 주세요." }, { status: 400 });
    }

    const attId = parseBigInt(id);
    if (!attId) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const attendance = await prisma.dailyAttendance.findUnique({
      where: { id: attId },
      include: {
        assignment: {
          select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true },
        },
      },
    });

    if (!attendance) {
      return NextResponse.json({ success: false, message: "기록을 찾을 수 없습니다." }, { status: 404 });
    }
    if (attendance.workerId.toString() !== session.workerId) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }
    if (attendance.isManagerFinalClosed || attendance.isFinalClosed) {
      return NextResponse.json(
        { success: false, message: "이미 확정된 기록입니다." },
        { status: 409 },
      );
    }
    // 퇴근 미실행 = 과거 날짜 + 아직 WORKING(퇴근 안 누름) + 실제 출근(actualStartTime)한 기록만.
    //  ★일지 작성이 만든 placeholder(actualStartTime=null)는 출근한 적이 없으므로 퇴근 처리 대상 아님.
    //   이를 확정(DONE·isFinalClosed)하면 startTime=null인 채 급여에 '유령 근무일'로 집계된다
    //   (workedDays +1 → DAILY/MONTHLY 과지급·4대보험 일수 부풀림). homeSummary missedRows와 동일 불변식.
    const today = getKstDateString();
    if (attendance.status !== "WORKING" || attendance.workDate >= today || !attendance.actualStartTime) {
      return NextResponse.json(
        { success: false, message: "퇴근 미실행 상태의 기록이 아닙니다." },
        { status: 409 },
      );
    }

    // 표준 퇴근시각(근무형태별, 예외 포함/미포함 반영)으로 출근부 퇴근시각 채움
    const workTimes = computeWorkTimes(
      attendance.assignment?.workType,
      attendance.assignment?.commuteGuidanceIncluded ?? true,
      attendance.assignment?.customWorkStart,
      attendance.assignment?.customWorkEnd,
    );
    const fixedEnd = kstWallTimeToInstant(attendance.workDate, workTimes.end);

    await prisma.dailyAttendance.update({
      where: { id: attendance.id },
      data: {
        endTime: fixedEnd,
        status: "DONE",
        isFinalClosed: true,
        finalizedAt: new Date(),
        lateClockOutAt: new Date(),
        lateClockOutReasonCode: reasonCode,
        lateClockOutReason: reasonText || null,
      },
    });

    return NextResponse.json({ success: true, message: "퇴근 처리되었습니다." });
  } catch (error) {
    console.error("[worker late-clockout]", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
