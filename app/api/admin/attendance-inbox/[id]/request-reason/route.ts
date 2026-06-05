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
    const dailyAttendanceId = BigInt(id);

    const att = await prisma.dailyAttendance.findFirst({
      where: { id: dailyAttendanceId, site: { agencyId: scope.agencyId } },
      select: { id: true, workerId: true, workDate: true },
    });
    if (!att) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });

    const body = await req.json().catch(() => ({} as any));
    const message =
      typeof body?.message === "string" && body.message.trim()
        ? body.message.trim()
        : "직무지도원 사유 등록 요청";

    const issue = await prisma.attendanceIssue.upsert({
      where: { dailyAttendanceId },
      create: {
        dailyAttendanceId,
        status: "REQUESTED",
        requestedAt: new Date(),
        events: {
          create: [
            {
              type: "REASON_REQUESTED",
              actorRole: "MANAGER",
              actorManagerId: scope.managerId,
              message,
            },
          ],
        },
      },
      update: {
        status: "REQUESTED",
        requestedAt: new Date(),
        events: {
          create: [
            {
              type: "REASON_REQUESTED",
              actorRole: "MANAGER",
              actorManagerId: scope.managerId,
              message,
            },
          ],
        },
      },
      select: { status: true, requestedAt: true, updatedAt: true },
    });

    // 워커 알림(발견성): 사유 입력 요청이 왔음을 워커앱에서 보이도록.
    try {
      await prisma.workerNotice.create({
        data: {
          workerId: att.workerId,
          agencyId: scope.agencyId,
          title: "[근태] 출근 사유 입력 요청",
          body: `${att.workDate} 근태에 대해 사유 입력이 요청되었습니다. 아래를 눌러 사유를 입력해주세요.`,
          type: "INFO",
          link: "/worker/review/attendance",
        },
      });
    } catch { /* 비치명적 */ }

    return NextResponse.json({ success: true, issue });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_REQUEST_REASON_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
