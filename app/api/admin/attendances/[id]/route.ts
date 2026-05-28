// PATCH /api/admin/attendances/[id] — 관리자 출근부 시간 직접 수정
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAgencyScope } from "@/lib/adminScope";

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
    const scope    = await requireAdminSession(req);
    const agencyId = requireAgencyScope(scope);

    const { id } = await params;
    if (!/^\d+$/.test(id))
      return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const record = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(id) },
      include: { assignment: { select: { agencyId: true } } },
    });

    if (!record)
      return NextResponse.json({ success: false, message: "기록을 찾을 수 없습니다." }, { status: 404 });

    // 에이전시 스코프 검증
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
      updateData.isFinalClosed = body.isFinalClosed;
      if (body.isFinalClosed) updateData.finalizedAt = new Date();
    }

    await prisma.dailyAttendance.update({ where: { id: record.id }, data: updateData });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/attendances/[id] PATCH]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
