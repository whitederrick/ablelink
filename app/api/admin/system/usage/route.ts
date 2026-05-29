// AI 사용량 통계 (월별·에이전시별)
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    if (scope.role !== "ADMIN") return NextResponse.json({ success: false, message: "FORBIDDEN" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const ym = searchParams.get("yearMonth") ?? new Date().toISOString().slice(0,7);
    const [y, m] = ym.split("-");
    const from = new Date(`${ym}-01T00:00:00.000Z`);
    const to   = new Date(Number(y), Number(m), 1); // next month start

    // 기간 내 ApiCallLog 집계
    const byAgency = await prisma.apiCallLog.groupBy({
      by: ["agencyId", "service"],
      where: { createdAt: { gte: from, lt: to } },
      _count: { id: true },
    });

    // 에이전시 이름 조회
    const agencyIds = [...new Set(byAgency.map(r => r.agencyId).filter(Boolean))] as bigint[];
    const agencies  = await prisma.agency.findMany({
      where: { id: { in: agencyIds } },
      select: { id: true, name: true },
    });
    const agencyMap = new Map(agencies.map(a => [a.id.toString(), a.name]));

    // 전체 집계
    const totals = byAgency.reduce((acc, r) => {
      acc[r.service] = (acc[r.service] ?? 0) + r._count.id;
      return acc;
    }, {} as Record<string, number>);

    // 에이전시별 집계
    const perAgency = byAgency.reduce((acc, r) => {
      const key = r.agencyId?.toString() ?? "unknown";
      if (!acc[key]) acc[key] = { name: agencyMap.get(key) ?? "알 수 없음", calls: {} };
      acc[key].calls[r.service] = (acc[key].calls[r.service] ?? 0) + r._count.id;
      return acc;
    }, {} as Record<string, { name: string; calls: Record<string,number> }>);

    return NextResponse.json({ success: true, yearMonth: ym, totals, perAgency });
  } catch (e: any) {
    if (e instanceof Response) return e;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
