// 위탁기관 관리자: 출근부 수정 요청 목록 조회
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { getKstHms } from "@/lib/time";

// ★13차: 시각은 KST 고정. startTime/endTime은 UTC instant 저장이라 서버(UTC) getHours()로 포맷하면 9시간
//  이르게 표시(08:30→23:30)돼, 매니저가 워커 요청값(KST)과 다른 현재값을 대조해 승인/반려를 오판했음.
function hhmmKst(dt: Date | null): string | null {
  if (!dt) return null;
  const { hh, mm } = getKstHms(dt);
  return `${hh}:${mm}`;
}

export async function GET(req: Request) {
  try {
    const scope = await requireManagerSession(req);

    const where: any = {};

    // 소속 위탁기관의 배정된 직무지도원만
    where.attendance = {
      assignment: { agencyId: scope.agencyId },
    };

    const requests = await prisma.attendanceEditRequest.findMany({
      where,
      include: {
        user:       { select: { id: true, workerName: true, phoneNumber: true } },
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
        workerId:       r.workerId.toString(),
        workerName:     r.user.workerName,
        userPhone:    r.user.phoneNumber ?? "",
        workDate:     r.attendance.workDate,
        siteName:     r.attendance.site?.companyName ?? "",
        currentStart: hhmmKst(r.attendance.startTime),
        currentEnd:   hhmmKst(r.attendance.endTime),
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
  } catch (e: unknown) {
    // requireManagerSession은 NextResponse(401)를 throw — 401이 500으로 오변환되지 않게 패스스루.
    if (e instanceof Response) return e;
    console.error("[admin/attendance-edit-requests GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
