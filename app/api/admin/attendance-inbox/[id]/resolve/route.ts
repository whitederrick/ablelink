// app/api/admin/attendance-inbox/[id]/resolve/route.ts
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
      // ★18차(P1): 소유권은 site.agencyId(참고용·nullable·공유현장)가 아니라 assignment.agencyId(실귀속·non-null).
      //  site로 게이트하면 공유현장에서 타 기관 근태를 조작·확정할 수 있다(읽기 라우트와 통일).
      where: { id: dailyAttendanceId, assignment: { agencyId: scope.agencyId } },
      select: { id: true },
    });
    if (!att) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });

    const issue = await prisma.attendanceIssue.upsert({
      where: { dailyAttendanceId },
      create: {
        dailyAttendanceId,
        status: "RESOLVED",
        resolvedAt: new Date(),
        events: {
          create: [
            {
              type: "RESOLVED",
              actorRole: "MANAGER",
              actorManagerId: scope.managerId,
              message: "처리 완료",
            },
          ],
        },
      },
      update: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        events: {
          create: [
            {
              type: "RESOLVED",
              actorRole: "MANAGER",
              actorManagerId: scope.managerId,
              message: "처리 완료",
            },
          ],
        },
      },
      select: { status: true, resolvedAt: true, updatedAt: true },
    });

    return NextResponse.json({ success: true, issue });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_INBOX_RESOLVE_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
