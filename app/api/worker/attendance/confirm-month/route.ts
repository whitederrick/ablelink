export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const { yearMonth } = await req.json().catch(() => ({}));
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });

    const [y, m] = yearMonth.split("-").map(Number);
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`;
    const now      = new Date();

    const result = await prisma.dailyAttendance.updateMany({
      where: {
        workerId:               BigInt(session.workerId),
        workDate:             { gte: dateFrom, lte: dateTo },
        isFinalClosed:        false,
        isManagerFinalClosed: false,
        startTime:            { not: null },
        // 퇴근 미실행(endTime null)·근무중(WORKING) 행은 확정 제외 — 급여 과지급·문서 불일치·clock-out 데드엔드 방지.
        endTime:              { not: null },
      },
      data: { isFinalClosed: true, finalizedAt: now, status: "DONE" },
    });

    return NextResponse.json({ success: true, confirmed: result.count });
  } catch (e: any) {
    console.error("[attendance/confirm-month]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
