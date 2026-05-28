export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

// KST "HH:MM" + workDate "YYYY-MM-DD" → UTC Date
function kstHHMMtoUTC(hhMM: string, workDate: string): Date | null {
  if (!hhMM || !/^\d{2}:\d{2}$/.test(hhMM)) return null;
  const [h, m] = hhMM.split(":").map(Number);
  const utcMs = new Date(`${workDate}T00:00:00Z`).getTime() + (h * 60 + m - 9 * 60) * 60000;
  return new Date(utcMs);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { id } = await params;
    const record = await prisma.dailyAttendance.findUnique({
      where: { id: BigInt(id) },
      select: { id: true, userId: true, workDate: true, isFinalClosed: true, startTime: true, endTime: true },
    });

    if (!record)
      return NextResponse.json({ success: false, message: "기록을 찾을 수 없습니다." }, { status: 404 });
    if (record.userId.toString() !== session.userId)
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    if (record.isFinalClosed)
      return NextResponse.json({ success: false, message: "이미 확정된 기록입니다." }, { status: 409 });

    const body = await req.json().catch(() => ({}));
    const updateData: any = { isFinalClosed: true, finalizedAt: new Date(), status: "DONE" };

    if (body.startTime) {
      const t = kstHHMMtoUTC(body.startTime, record.workDate);
      if (t) updateData.startTime = t;
    }
    if (body.endTime) {
      const t = kstHHMMtoUTC(body.endTime, record.workDate);
      if (t) updateData.endTime = t;
    }

    await prisma.dailyAttendance.update({ where: { id: record.id }, data: updateData });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[attendance/[id]/confirm]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
