// app/api/admin/attendance-inbox/[id]/request-supplement/route.ts
// 위탁기관→직무지도원 '사유 보완 요청'. 직무지도원이 회신한 사유가 불충분할 때 보완(재작성)을 요청한다.
// SUPPLEMENT_REQUESTED 이벤트(타임라인) + 워커 알림 + 멱등(회신 대기 중이면 중복 차단). 사유 요청과 동일 패턴.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);
    const { id } = await params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ success: false, message: "INVALID_ID" }, { status: 400 });
    const dailyAttendanceId = BigInt(id);

    const att = await prisma.dailyAttendance.findFirst({
      // ★18차(P1): 소유권 = assignment.agencyId(실귀속·non-null), site.agencyId 아님(공유현장 크로스테넌트 방지).
      where: { id: dailyAttendanceId, assignment: { agencyId: scope.agencyId } },
      select: { id: true, workerId: true, workDate: true },
    });
    if (!att) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });

    const existingIssue = await prisma.attendanceIssue.findUnique({ where: { dailyAttendanceId }, select: { status: true } });
    if (!existingIssue) {
      return NextResponse.json({ success: false, message: "보완을 요청할 사유 회신이 없습니다." }, { status: 400 });
    }
    // 멱등: 이미 회신 대기(REQUESTED)면 중복 차단.
    if (existingIssue.status === "REQUESTED") {
      return NextResponse.json({ success: false, code: "ALREADY_REQUESTED", message: "이미 요청했습니다. 직무지도원 회신을 기다려주세요." }, { status: 409 });
    }

    const body = await req.json().catch(() => ({} as any));
    const message = typeof body?.message === "string" && body.message.trim() ? body.message.trim() : "사유 보완 요청";

    // 회신 대기 상태(REQUESTED)로 되돌리고 보완요청 이벤트 기록. 직무지도원은 사유를 다시 제출(보완)한다.
    await prisma.attendanceIssue.update({
      where: { dailyAttendanceId },
      data: {
        status: "REQUESTED",
        requestedAt: new Date(),
        events: { create: [{ type: "SUPPLEMENT_REQUESTED", actorRole: "MANAGER", actorManagerId: scope.managerId, message }] },
      },
    });

    try {
      await prisma.workerNotice.create({
        data: {
          workerId: att.workerId,
          agencyId: scope.agencyId,
          title: "[근태] 사유 보완 요청",
          body: `${att.workDate} 근태 사유에 대한 보완이 요청되었습니다.\n\n${message}\n\n아래를 눌러 사유를 보완(다시 제출)해주세요.`,
          type: "WARN",
          link: "/worker/review/attendance",
        },
      });
    } catch { /* 비치명적 */ }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_ATTENDANCE_REQUEST_SUPPLEMENT_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
