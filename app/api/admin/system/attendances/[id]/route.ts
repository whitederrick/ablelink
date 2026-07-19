// 시스템 운영자 전용: 출근 기록 직접 수정 (데이터 교정 도구)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { audit } from "@/lib/audit";
import { kstWallTimeToInstant } from "@/lib/workSchedule";

const HHMM_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    if (!/^[0-9]+$/.test(id)) return NextResponse.json({ success: false, message: "잘못된 ID입니다." }, { status: 400 });
    const body = await req.json().catch(() => ({}));
    const { startTime, endTime, reason } = body;

    if (!reason?.trim()) {
      return NextResponse.json({ success: false, message: "수정 사유는 필수입니다." }, { status: 400 });
    }

    const attendance = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(id) },
      include: { user: { select: { workerName: true } } },
    });
    if (!attendance) return NextResponse.json({ success: false, message: "출근 기록을 찾을 수 없습니다." }, { status: 404 });

    const updateData: any = {};
    // #5: 운영자가 입력한 HH:MM은 KST 벽시계 → kstWallTimeToInstant로 -9h 보정한 instant 저장.
    //  과거 `new Date(workDate+"T00:00:00")+setHours`는 서버 로컬(UTC) 기준이라 운영에서 9시간 어긋난
    //  시각이 저장됐다(정상 출퇴근 저장 경로 workSchedule과 동일 헬퍼로 통일).
    if (startTime) {
      if (!HHMM_RE.test(String(startTime))) return NextResponse.json({ success: false, message: "출근 시각 형식이 올바르지 않습니다. (HH:MM)" }, { status: 400 });
      updateData.startTime = kstWallTimeToInstant(attendance.workDate, startTime);
    }
    if (endTime) {
      if (!HHMM_RE.test(String(endTime))) return NextResponse.json({ success: false, message: "퇴근 시각 형식이 올바르지 않습니다. (HH:MM)" }, { status: 400 });
      updateData.endTime = kstWallTimeToInstant(attendance.workDate, endTime);
      updateData.status  = "DONE";
    }

    await prisma.dailyAttendance.update({ where: { id: attendance.id }, data: updateData });

    await audit(scope, {
      entityType: "DailyAttendance",
      entityId: attendance.id,
      action: "update",
      summary: `출근기록 보정: ${reason}`,
      before: {
        startTime: attendance.startTime?.toISOString() ?? null,
        endTime: attendance.endTime?.toISOString() ?? null,
        status: attendance.status,
      },
      after: {
        startTime: (updateData.startTime ?? attendance.startTime)?.toISOString() ?? null,
        endTime: (updateData.endTime ?? attendance.endTime)?.toISOString() ?? null,
        status: updateData.status ?? attendance.status,
      },
    });

    return NextResponse.json({ success: true, message: "출근 기록이 수정되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
