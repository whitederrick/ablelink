// 시스템 운영자: 출근 기록 검색 (데이터 교정 도구)
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { getKstHms } from "@/lib/time";

export async function GET(req: NextRequest) {
  try {
    await requireAdminSession(req);

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

    // ★13차: 시각은 KST 고정(getKstHms). startTime/endTime은 UTC instant로 저장돼(kstWallTimeToInstant),
    //  서버(UTC) getHours()로 포맷하면 9시간 이르게 표시(08:30→23:30)돼 운영자 교정 오판을 유발했음.
    function hhMM(dt: Date | null) {
      if (!dt) return null;
      const { hh, mm } = getKstHms(dt);
      return `${hh}:${mm}`;
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
