export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

function fmtKST(d: Date | null): string {
  if (!d) return "";
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const yearMonth = new URL(req.url).searchParams.get("yearMonth") ?? "";
    if (!/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });

    const [y, m] = yearMonth.split("-").map(Number);
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`;

    const records = await prisma.dailyAttendance.findMany({
      where: {
        workerId:   BigInt(session.workerId),
        workDate: { gte: dateFrom, lte: dateTo },
      },
      orderBy: { workDate: "asc" },
    });

    return NextResponse.json({
      success: true,
      records: records.map(r => ({
        id:            r.id.toString(),
        workDate:      r.workDate,
        startTime:     fmtKST(r.startTime),
        endTime:       fmtKST(r.endTime),
        isFinalClosed: r.isFinalClosed,
        isGpsModified: r.isGpsModified,
        status:        r.status,
      })),
    });
  } catch (e: any) {
    console.error("[attendance/monthly]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
