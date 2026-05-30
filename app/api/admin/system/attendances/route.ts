// 시스템 운영자: 출근 기록 검색 (데이터 교정 도구)
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);

    const { searchParams } = new URL(req.url);
    const q        = searchParams.get("q")?.trim() ?? "";
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo   = searchParams.get("dateTo")   ?? "";
    const flag     = searchParams.get("flag")     ?? ""; // "gps" | "no_end"

    const records = await prisma.dailyAttendance.findMany({
      where: {
        ...(dateFrom && dateTo ? { workDate: { gte: dateFrom, lte: dateTo } } : {}),
        ...(flag === "gps"    ? { isGpsModified: true } : {}),
        ...(flag === "no_end" ? { endTime: null, status: "WORKING" } : {}),
        ...(q ? {
          OR: [
            { user:      { workerName:    { contains: q } } },
            { site:      { companyName: { contains: q } } },
          ],
        } : {}),
      },
      include: {
        user: { select: { id: true, workerName: true } },
        site: { select: { id: true, companyName: true, agency: { select: { name: true } } } },
      },
      orderBy: [{ workDate: "desc" }, { id: "desc" }],
      take: 100,
    });

    function hhMM(dt: Date | null) {
      if (!dt) return null;
      const h = String(dt.getHours()).padStart(2,"0"), m = String(dt.getMinutes()).padStart(2,"0");
      return `${h}:${m}`;
    }

    return NextResponse.json({
      success: true,
      records: records.map(r => ({
        id:            r.id.toString(),
        workerId:        r.workerId.toString(),
        workerName:      r.user.workerName,
        siteId:        r.siteId.toString(),
        siteName:      r.site.companyName,
        agencyName:    r.site.agency?.name ?? "",
        workDate:      r.workDate,
        startTime:     hhMM(r.startTime),
        endTime:       hhMM(r.endTime),
        status:        r.status,
        isFinalClosed: r.isFinalClosed,
        isGpsModified: r.isGpsModified,
      })),
    });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
