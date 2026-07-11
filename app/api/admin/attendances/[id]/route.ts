// PATCH /api/admin/attendances/[id] — 관리자 출근부 시간 직접 수정
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { audit, auditSnapshot } from "@/lib/audit";

// KST "HH:MM" + workDate "YYYY-MM-DD" → UTC Date
function kstToUTC(hhMM: string, workDate: string): Date | null {
  if (!hhMM || !/^\d{2}:\d{2}$/.test(hhMM)) return null;
  const [h, m] = hhMM.split(":").map(Number);
  return new Date(new Date(`${workDate}T00:00:00Z`).getTime() + (h * 60 + m - 9 * 60) * 60000);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const scope    = await requireManagerSession(req);
    const agencyId = scope.agencyId;

    const { id } = await params;
    if (!/^\d+$/.test(id))
      return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const record = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(id) },
      include: { assignment: { select: { agencyId: true } } },
    });

    if (!record)
      return NextResponse.json({ success: false, message: "기록을 찾을 수 없습니다." }, { status: 404 });

    // 위탁기관 스코프 검증
    if (!record.assignment?.agencyId || record.assignment.agencyId.toString() !== agencyId.toString())
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const updateData: any = { isGpsModified: true }; // 관리자 수정은 GPS 수정 플래그

    if (body.startTime) {
      const t = kstToUTC(body.startTime, record.workDate);
      if (t) updateData.startTime = t;
    }
    if (body.endTime) {
      const t = kstToUTC(body.endTime, record.workDate);
      if (t) updateData.endTime = t;
    }
    if (typeof body.isFinalClosed === "boolean") {
      // ★확정 시 시각 필수(startTime·endTime): 시각 없는 placeholder를 확정하면 급여에 유령 근무일이 잡힘.
      //  형제 finalize 경로와 통일(8차). computeRun chokepoint(startTime not null)와 이중 방어.
      if (body.isFinalClosed) {
        const finalStart = updateData.startTime ?? record.startTime;
        const finalEnd = updateData.endTime ?? record.endTime;
        if (!finalStart || !finalEnd) {
          return NextResponse.json({ success: false, message: "출근·퇴근 시각이 모두 있어야 확정할 수 있습니다." }, { status: 400 });
        }
      }
      updateData.isFinalClosed = body.isFinalClosed;
      if (body.isFinalClosed) updateData.finalizedAt = new Date();
    }

    const auditBefore = await auditSnapshot("DailyAttendance", { id: record.id }, updateData);
    await prisma.dailyAttendance.update({ where: { id: record.id }, data: updateData });
    await audit(scope, { entityType: "DailyAttendance", entityId: record.id, action: "update", before: auditBefore, after: updateData });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/attendances/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
