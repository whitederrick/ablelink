// 에이전시 관리자: 출근부 수정 요청 목록 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: Request) {
  try {
    const scope = await requireAdminSession(req);

    const where: any = {};

    if (scope.role === "AGENCY") {
      if (!scope.agencyId) return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });
      // 소속 에이전시의 배정된 직무지도원만
      where.attendance = {
        assignment: { agencyId: scope.agencyId },
      };
    }

    const requests = await prisma.attendanceEditRequest.findMany({
      where,
      include: {
        user:       { select: { id: true, userName: true, phoneNumber: true } },
        attendance: {
          select: {
            id: true, workDate: true, startTime: true, endTime: true,
            isGpsModified: true, status: true, isFinalClosed: true,
            site: { select: { companyName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    return NextResponse.json({
      success: true,
      requests: requests.map(r => ({
        id:           r.id.toString(),
        attendanceId: r.attendanceId.toString(),
        userId:       r.userId.toString(),
        userName:     r.user.userName,
        userPhone:    r.user.phoneNumber ?? "",
        workDate:     r.attendance.workDate,
        siteName:     r.attendance.site?.companyName ?? "",
        currentStart: r.attendance.startTime
          ? `${String(r.attendance.startTime.getHours()).padStart(2,"0")}:${String(r.attendance.startTime.getMinutes()).padStart(2,"0")}`
          : null,
        currentEnd: r.attendance.endTime
          ? `${String(r.attendance.endTime.getHours()).padStart(2,"0")}:${String(r.attendance.endTime.getMinutes()).padStart(2,"0")}`
          : null,
        isFinalClosed: r.attendance.isFinalClosed,
        isGpsModified: r.attendance.isGpsModified,
        reason:        r.reason,
        proposedStart: r.proposedStart,
        proposedEnd:   r.proposedEnd,
        status:        r.status,
        adminNote:     r.adminNote,
        reviewedAt:    r.reviewedAt?.toISOString() ?? null,
        createdAt:     r.createdAt.toISOString(),
      })),
    });
  } catch (e: any) {
    console.error("[admin/attendance-edit-requests GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
