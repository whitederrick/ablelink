// app/api/worker/history/route.ts
// 직무지도원 본인 근무 이력 조회

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

function pad2(n: number) { return String(n).padStart(2, "0"); }

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const yearMonth = searchParams.get("yearMonth");

    const workerId = BigInt(session.workerId);
    let dateFilter: { gte: string; lte: string } | undefined;

    if (yearMonth && /^\d{4}-\d{2}$/.test(yearMonth)) {
      const [y, m] = yearMonth.split("-").map(Number);
      dateFilter = {
        gte: `${yearMonth}-01`,
        lte: `${yearMonth}-${pad2(new Date(y, m, 0).getDate())}`,
      };
    }

    const attendances = await prisma.dailyAttendance.findMany({
      where: {
        workerId,
        ...(dateFilter ? { workDate: dateFilter } : {}),
      },
      include: {
        site: { select: { companyName: true } },
        assignment: { select: { serviceStep: true, agencyId: true } },
        logs: { select: { isCompleted: true, totalRecognizedTime: true } },
        attendanceIssue: { select: { status: true, issueTypes: true } },
      },
      orderBy: { workDate: "desc" },
      take: 200,
    });

    const items = attendances.map(a => {
      const startMs = a.startTime?.getTime();
      const endMs = a.endTime?.getTime();
      const workedMinutes = startMs && endMs ? Math.round((endMs - startMs) / 60000) : 0;

      return {
        id: a.id.toString(),
        workDate: a.workDate,
        siteName: a.site?.companyName ?? "-",
        serviceStep: a.assignment?.serviceStep ?? null,
        startTime: a.startTime ? a.startTime.toISOString() : null,
        endTime: a.endTime ? a.endTime.toISOString() : null,
        workedMinutes,
        isFinalClosed: a.isFinalClosed,
        isGpsModified: a.isGpsModified,
        logStatus: a.logs.length === 0 ? "NONE"
          : a.logs.every(l => l.isCompleted) ? "DONE" : "DRAFT",
        hasIssue: !!a.attendanceIssue && a.attendanceIssue.status !== "RESOLVED",
        issueTypes: a.attendanceIssue?.issueTypes ?? [],
      };
    });

    // 월별 통계
    const stats = {
      total: items.length,
      workedDays: items.filter(i => i.startTime).length,
      totalMinutes: items.reduce((s, i) => s + i.workedMinutes, 0),
      issueCount: items.filter(i => i.hasIssue).length,
    };

    return NextResponse.json({ success: true, items, stats });
  } catch (e: any) {
    console.error("[worker/history]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
