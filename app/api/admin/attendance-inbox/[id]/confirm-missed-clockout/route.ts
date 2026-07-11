// app/api/admin/attendance-inbox/[id]/confirm-missed-clockout/route.ts
// 위탁기관 매니저: '퇴근 미실행'(직무지도원이 끝내 늦은 퇴근을 처리하지 않은 보정대기 건)을
// 표준 퇴근시각으로 확정하는 폴백. 매니저 책임 확정이므로 isManagerFinalClosed로 잠근다.

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import { getKstDateString } from "@/lib/time";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const scope = await requireManagerSession(req);

    const { id } = await params;
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ success: false, message: "INVALID_ID" }, { status: 400 });
    }
    const attendanceId = BigInt(id);

    const att = await prisma.dailyAttendance.findFirst({
      where: { id: attendanceId, site: { agencyId: scope.agencyId } },
      include: {
        assignment: {
          select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true },
        },
      },
    });
    if (!att) return NextResponse.json({ success: false, message: "NOT_FOUND" }, { status: 404 });
    if (att.isFinalClosed || att.isManagerFinalClosed) {
      return NextResponse.json({ success: false, message: "이미 확정된 출근 기록입니다." }, { status: 409 });
    }
    const today = getKstDateString();
    // ★실제 출근(actualStartTime)한 기록만 확정 가능. 워커 late-clockout(38e1afd)과 동일 불변식:
    //  출근 없이 일지만 쓴 placeholder(actualStartTime=null)를 확정하면 startTime=null인 채 급여에
    //  '유령 근무일'로 집계된다(workedDays +1 → 과지급). 팀 설계상 '시각 없는 행은 isFinalClosed 금지'.
    if (att.status !== "WORKING" || att.workDate >= today || !att.actualStartTime) {
      return NextResponse.json({ success: false, message: "퇴근 미실행 상태의 기록이 아닙니다." }, { status: 409 });
    }

    const workTimes = computeWorkTimes(
      att.assignment?.workType,
      att.assignment?.commuteGuidanceIncluded ?? true,
      att.assignment?.customWorkStart,
      att.assignment?.customWorkEnd,
    );
    const fixedEnd = kstWallTimeToInstant(att.workDate, workTimes.end);

    const now = new Date();
    await prisma.dailyAttendance.update({
      where: { id: attendanceId },
      data: {
        endTime: fixedEnd,
        status: "DONE",
        isFinalClosed: true,
        finalizedAt: now,
        isManagerFinalClosed: true,
        managerFinalAt: now,
        managerFinalBy: scope.managerId,
      },
    });

    // 워커 알림(앱 내, 무료)
    try {
      await prisma.workerNotice.create({
        data: {
          workerId: att.workerId,
          agencyId: scope.agencyId,
          title: "퇴근 미실행 확정 안내",
          body: `${att.workDate} 퇴근 미실행 건이 위탁기관 관리자에 의해 표준 퇴근시각으로 확정되었습니다.`,
          type: "INFO",
        },
      });
    } catch { /* 비치명적 */ }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[ADMIN_CONFIRM_MISSED_CLOCKOUT_ERROR]", e);
    return NextResponse.json({ success: false, message: "INTERNAL_ERROR" }, { status: 500 });
  }
}
