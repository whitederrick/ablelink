// app/api/worker/attendance/issues/route.ts
// 매니저가 사유 등록을 요청한 근태 이슈(REQUESTED) 목록 — 워커가 사유를 입력해야 하는 건.
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

const TYPE_LABEL: Record<string, string> = {
  MISSING_CLOCK_IN: "출근 기록 누락",
  MISSING_CLOCK_OUT: "퇴근 기록 누락",
  OUT_OF_RANGE: "근무지 범위 이탈",
  TIME_ANOMALY: "근무시간 이상",
};

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const issues = await prisma.attendanceIssue.findMany({
      where: { status: "REQUESTED", dailyAttendance: { workerId } },
      orderBy: { requestedAt: "desc" },
      take: 100,
      select: {
        id: true,
        issueTypes: true,
        workerReasonText: true,
        requestedAt: true,
        dailyAttendance: { select: { workDate: true, site: { select: { companyName: true } } } },
        events: {
          where: { type: { in: ["REASON_REQUESTED", "SUPPLEMENT_REQUESTED"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { message: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      issues: issues.map((i) => ({
        id: i.id.toString(),
        workDate: i.dailyAttendance?.workDate ?? null,
        siteName: i.dailyAttendance?.site?.companyName ?? null,
        issueTypes: (i.issueTypes as string[]).map((t) => TYPE_LABEL[t] ?? t),
        requestMessage: i.events[0]?.message ?? null,
        requestedAt: i.requestedAt ? i.requestedAt.toISOString() : null,
      })),
    });
  } catch (e: any) {
    console.error("[worker/attendance/issues GET]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
