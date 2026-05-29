export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, message: "INVALID_ID" }, { status: 400 });
    }
    const dailyAttendanceId = BigInt(id);

    const att = await prisma.dailyAttendance.findFirst({
      where: { id: dailyAttendanceId, site: { agencyId: scope.agencyId } },
      select: { id: true },
    });
    if (!att) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });

    const body = await req.json().catch(() => ({} as any));
    const memo = typeof body?.memo === "string" ? body.memo : "";

    const issue = await prisma.attendanceIssue.upsert({
      where: { dailyAttendanceId },
      create: {
        dailyAttendanceId,
        adminMemo: memo,
        events: {
          create: [
            {
              type: "MEMO_UPDATED",
              actorRole: "MANAGER",
              actorManagerId: scope.managerId,
              message: memo || "(빈 메모)",
            },
          ],
        },
      },
      update: {
        adminMemo: memo,
        events: {
          create: [
            {
              type: "MEMO_UPDATED",
              actorRole: "MANAGER",
              actorManagerId: scope.managerId,
              message: memo || "(빈 메모)",
            },
          ],
        },
      },
      select: { adminMemo: true, updatedAt: true },
    });

    return NextResponse.json({ success: true, issue });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_MEMO_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
