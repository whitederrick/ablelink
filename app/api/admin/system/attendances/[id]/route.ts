// 시스템 운영자 전용: 출근 기록 직접 수정 (데이터 교정 도구)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { logAudit } from "@/lib/auditLog";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireAdminSession(req);

    const { id } = await params;
    const body = await req.json();
    const { startTime, endTime, reason } = body;

    if (!reason?.trim()) {
      return NextResponse.json({ success: false, message: "수정 사유는 필수입니다." }, { status: 400 });
    }

    const attendance = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(id) },
      include: { user: { select: { userName: true } } },
    });
    if (!attendance) return NextResponse.json({ success: false, message: "출근 기록을 찾을 수 없습니다." }, { status: 404 });

    const updateData: any = {};
    if (startTime) {
      const [h, m] = startTime.split(":").map(Number);
      const dt = new Date(attendance.workDate + "T00:00:00");
      dt.setHours(h, m, 0, 0);
      updateData.startTime = dt;
    }
    if (endTime) {
      const [h, m] = endTime.split(":").map(Number);
      const dt = new Date(attendance.workDate + "T00:00:00");
      dt.setHours(h, m, 0, 0);
      updateData.endTime = dt;
      updateData.status  = "DONE";
    }

    await prisma.dailyAttendance.update({ where: { id: attendance.id }, data: updateData });

    await logAudit({
      adminId: scope.adminId,
      action:  "ATTENDANCE_CORRECTED",
      target:  `DailyAttendance:${attendance.id}`,
      detail:  {
        userName: attendance.user?.userName,
        workDate: attendance.workDate,
        before:   {
          startTime: attendance.startTime?.toISOString(),
          endTime:   attendance.endTime?.toISOString(),
        },
        after: updateData,
        reason,
      },
    });

    return NextResponse.json({ success: true, message: "출근 기록이 수정되었습니다." });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
