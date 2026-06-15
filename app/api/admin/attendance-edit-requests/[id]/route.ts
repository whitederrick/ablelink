// 위탁기관 관리자: 출근부 수정 요청 승인/반려
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { kstWallTimeToInstant } from "@/lib/workSchedule";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    const body = await req.json();
    const { action, adminNote } = body; // action: "approve" | "reject"

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json({ success: false, message: "action은 approve 또는 reject여야 합니다." }, { status: 400 });
    }

    const request = await prisma.attendanceEditRequest.findUnique({
      where: { id: BigInt(id) },
      include: {
        attendance: {
          include: { site: { select: { agencyId: true } } },
        },
      },
    });

    if (!request) return NextResponse.json({ success: false, message: "요청을 찾을 수 없습니다." }, { status: 404 });
    if (request.status !== "PENDING") {
      return NextResponse.json({ success: false, message: "이미 처리된 요청입니다." }, { status: 409 });
    }

    // 소속 위탁기관 소속인지 확인
    const siteAgencyId = request.attendance.site?.agencyId;
    if (!siteAgencyId || siteAgencyId !== scope.agencyId) {
      return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
    }

    const now = new Date();

    if (action === "approve") {
      // 1. 수정 요청 승인
      await prisma.attendanceEditRequest.update({
        where: { id: request.id },
        data: { status: "APPROVED", adminNote: adminNote?.trim() || null, reviewedAt: now },
      });

      // 2. 출근 기록에 제안된 시간 적용
      //    ⚠️ KST 벽시계 → UTC instant 보정(kstWallTimeToInstant). 다른 곳과 동일 출처를 써야 9시간 어긋남 방지.
      //    승인 = 위탁기관 컨펌 → payrollConfirmedAt 설정 → 출근부 급여 게이트 통과(보정대기 해제).
      const updateData: any = { payrollConfirmedAt: now };
      if (request.proposedStart) {
        updateData.startTime = kstWallTimeToInstant(request.attendance.workDate, request.proposedStart);
      }
      if (request.proposedEnd) {
        updateData.endTime = kstWallTimeToInstant(request.attendance.workDate, request.proposedEnd);
        updateData.status  = "DONE";
      }
      await prisma.dailyAttendance.update({
        where: { id: request.attendanceId },
        data: updateData,
      });

      return NextResponse.json({ success: true, message: "수정 요청이 승인되었습니다. 출근 기록이 업데이트되었습니다." });
    } else {
      // 반려
      await prisma.attendanceEditRequest.update({
        where: { id: request.id },
        data: { status: "REJECTED", adminNote: adminNote?.trim() || null, reviewedAt: now },
      });

      return NextResponse.json({ success: true, message: "수정 요청이 반려되었습니다." });
    }
  } catch (e: any) {
    console.error("[admin/attendance-edit-requests/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
