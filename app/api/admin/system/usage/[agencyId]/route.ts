// app/api/admin/system/usage/[agencyId]/route.ts
// 운영자: 특정 위탁기관의 월별 AI 사용 상세(서비스별·일자별·직무지도원별)
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, parseBigInt } from "@/lib/adminScope";

export async function GET(req: NextRequest, { params }: { params: Promise<{ agencyId: string }> }) {
  try {
    await requireAdminSession(req);
    const { agencyId: aidStr } = await params;
    const agencyId = parseBigInt(aidStr);
    if (!agencyId) return NextResponse.json({ success: false, message: "잘못된 ID" }, { status: 400 });

    const ym = new URL(req.url).searchParams.get("yearMonth") ?? "";
    if (!/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ success: false, message: "yearMonth 형식 오류" }, { status: 400 });
    const [y, m] = ym.split("-").map(Number);
    const from = new Date(y, m - 1, 1, 0, 0, 0);
    const to = new Date(y, m, 1, 0, 0, 0);

    const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } });

    const logs = await prisma.apiCallLog.findMany({
      where: { agencyId, createdAt: { gte: from, lt: to } },
      select: { service: true, workerId: true, createdAt: true },
    });

    const totals: Record<string, number> = {};
    const dailyMap = new Map<string, number>();
    const workerMap = new Map<string, number>();
    for (const l of logs) {
      totals[l.service] = (totals[l.service] ?? 0) + 1;
      const day = `${l.createdAt.getFullYear()}-${String(l.createdAt.getMonth() + 1).padStart(2, "0")}-${String(l.createdAt.getDate()).padStart(2, "0")}`;
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + 1);
      const wk = l.workerId ? l.workerId.toString() : "none";
      workerMap.set(wk, (workerMap.get(wk) ?? 0) + 1);
    }

    // 직무지도원 이름
    const wids = [...workerMap.keys()].filter(k => k !== "none").map(s => BigInt(s));
    const workers = wids.length ? await prisma.worker.findMany({ where: { id: { in: wids } }, select: { id: true, workerName: true } }) : [];
    const nameById = new Map(workers.map(w => [w.id.toString(), w.workerName]));

    const daily = [...dailyMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
    const byWorker = [...workerMap.entries()]
      .map(([id, count]) => ({ workerName: id === "none" ? "미상" : (nameById.get(id) ?? `#${id}`), count }))
      .sort((a, b) => b.count - a.count);

    return NextResponse.json({ success: true, agencyName: agency?.name ?? "-", total: logs.length, totals, daily, byWorker });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/system/usage/[agencyId]]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
