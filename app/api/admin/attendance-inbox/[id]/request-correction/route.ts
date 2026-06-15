// app/api/admin/attendance-inbox/[id]/request-correction/route.ts
// 위탁기관→직무지도원 '시각 보정 요청'. 급여 보호 게이트 보정대기일(심한 지각/조퇴 미컨펌)에 대해
// 직무지도원에게 출근부 시각 수정요청 제출을 요청한다. 워커 알림(앱 내 무료) + 추적 컬럼 기록.
// 실제 보정시각 확정(payrollConfirmedAt)은 기존 출근부 수정요청 승인(admin/attendance-edit-requests)에서 일어남.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, message: "INVALID_ID" }, { status: 400 });
    }
    const attendanceId = BigInt(id);

    const att = await prisma.dailyAttendance.findFirst({
      where: { id: attendanceId, site: { agencyId: scope.agencyId } },
      select: { id: true, workerId: true, workDate: true, payrollConfirmedAt: true },
    });
    if (!att) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });
    if (att.payrollConfirmedAt) {
      return NextResponse.json({ success: false, message: "이미 보정이 확정된 출근 기록입니다." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({} as any));
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim() : null;

    const now = new Date();
    await prisma.dailyAttendance.update({
      where: { id: attendanceId },
      data: { correctionRequestedAt: now, correctionRequestNote: note },
    });

    // 워커 알림(앱 내, 무료): 보정 시각 입력 요청 발견성.
    try {
      await prisma.workerNotice.create({
        data: {
          workerId: att.workerId,
          agencyId: scope.agencyId,
          title: "[근태] 출근부 시각 보정 요청",
          body:
            `${att.workDate} 근태의 출퇴근 시각 보정이 요청되었습니다.` +
            (note ? `\n\n요청 메모: ${note}` : "") +
            `\n\n아래를 눌러 정확한 출퇴근 시각으로 수정요청을 제출해주세요. (승인 전까지 급여 산정이 보류됩니다.)`,
          type: "WARN",
          link: "/worker/review/attendance",
        },
      });
    } catch { /* 비치명적 */ }

    return NextResponse.json({ success: true, correctionRequestedAt: now.toISOString() });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_REQUEST_CORRECTION_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
