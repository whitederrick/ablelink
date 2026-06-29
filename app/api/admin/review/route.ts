export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { requireAdminOrManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";

// 월별 진척도 현황 관리 — 기관단위 요약 오버사이트.
// 핵심: "해당 월에 근무(배정)가 종료되는 직무지도원" 중 출근부/일지가 미완료인 건만 '독려 필요'로 집계.
//      (계속 근무 중인 직무지도원의 미완료는 진행 중이라 정상 → 독려 대상 아님)

export async function GET(req: NextRequest) {
  try {
    const session = await requireAdminOrManagerSession(req);

    const { searchParams } = new URL(req.url);
    const yearMonth = searchParams.get("yearMonth") ?? "";
    if (!/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });

    const [y, m] = yearMonth.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
    const dtFrom = new Date(`${dateFrom}T00:00:00`);
    const dtTo   = new Date(`${dateTo}T23:59:59`);

    const agencyScope = session.kind === "manager" ? { agencyId: session.agencyId } : {};

    // 그 달에 근무한 배정(진행중) + 그 달에 종료되는/종료된 배정
    const assignments = await prisma.siteAssignment.findMany({
      where: {
        ...agencyScope,
        OR: [
          { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
          { status: "ENDED", endDate: { gte: dtFrom, lte: dtTo } },
        ],
      },
      select: {
        endDate: true,
        user:   { select: { id: true, workerName: true, phoneNumber: true } },
        site:   { select: { companyName: true } },
        agency: { select: { id: true, name: true } },
      },
      orderBy: { assignedAt: "desc" },
    });

    // 직무지도원 단위 dedup(최신 배정 기준)
    type W = { id: string; name: string; phone: string; siteName: string; agencyId: string; agencyName: string; isEnding: boolean };
    const seen = new Map<string, W>();
    for (const a of assignments) {
      const id = a.user.id.toString();
      if (seen.has(id)) continue;
      const isEnding = a.endDate != null && a.endDate >= dtFrom && a.endDate <= dtTo;
      seen.set(id, {
        id, name: a.user.workerName, phone: a.user.phoneNumber ?? "",
        siteName: a.site?.companyName ?? "-",
        agencyId: a.agency?.id?.toString() ?? "0", agencyName: a.agency?.name ?? "-",
        isEnding,
      });
    }
    const workers = [...seen.values()];
    if (workers.length === 0) return NextResponse.json({ success: true, yearMonth, agencies: [] });

    const uids = workers.map(w => BigInt(w.id));

    const [attRows, logRows, evalRows] = await Promise.all([
      prisma.dailyAttendance.findMany({
        where: { workerId: { in: uids }, workDate: { gte: dateFrom, lte: dateTo }, startTime: { not: null } },
        select: { workerId: true, isFinalClosed: true },
      }),
      prisma.traineeLog.findMany({
        where: { writerId: { in: uids }, attendance: { workDate: { gte: dateFrom, lte: dateTo } } },
        select: { writerId: true, isCompleted: true },
      }),
      prisma.traineeEvaluation.findMany({
        where: { writerId: { in: uids }, periodStart: { gte: dateFrom }, periodEnd: { lte: dateTo } },
        select: { writerId: true, isConfirmed: true },
      }),
    ]);

    type C = { total: number; confirmed: number };
    const att = new Map<string, C>(), log = new Map<string, C>(), ev = new Map<string, C>();
    for (const w of workers) { att.set(w.id, { total: 0, confirmed: 0 }); log.set(w.id, { total: 0, confirmed: 0 }); ev.set(w.id, { total: 0, confirmed: 0 }); }
    for (const r of attRows) { const c = att.get(r.workerId.toString()); if (c) { c.total++; if (r.isFinalClosed) c.confirmed++; } }
    for (const r of logRows) { const c = log.get(r.writerId.toString()); if (c) { c.total++; if (r.isCompleted) c.confirmed++; } }
    for (const r of evalRows){ const c = ev.get(r.writerId.toString());  if (c) { c.total++; if (r.isConfirmed) c.confirmed++; } }

    // 기관별 집계
    type Ag = {
      agencyId: string; agencyName: string; workerCount: number;
      att: C; log: C;
      urgent: { workerId: string; workerName: string; phoneNumber: string; siteName: string; att: C; log: C }[];
    };
    const agMap = new Map<string, Ag>();
    for (const w of workers) {
      if (!agMap.has(w.agencyId)) agMap.set(w.agencyId, {
        agencyId: w.agencyId, agencyName: w.agencyName, workerCount: 0,
        att: { total: 0, confirmed: 0 }, log: { total: 0, confirmed: 0 }, urgent: [],
      });
      const ag = agMap.get(w.agencyId)!;
      const a = att.get(w.id)!, l = log.get(w.id)!;
      ag.workerCount++;
      ag.att.total += a.total; ag.att.confirmed += a.confirmed;
      ag.log.total += l.total; ag.log.confirmed += l.confirmed;
      // 독려 필요: 근무 종료되는 직무지도원 + (출근부 또는 일지가 기록은 있는데 미확정)
      const incomplete = (a.total > 0 && a.confirmed < a.total) || (l.total > 0 && l.confirmed < l.total);
      if (w.isEnding && incomplete) {
        ag.urgent.push({ workerId: w.id, workerName: w.name, phoneNumber: w.phone, siteName: w.siteName, att: a, log: l });
      }
    }

    const agencies = [...agMap.values()].sort((x, y2) => y2.urgent.length - x.urgent.length || x.agencyName.localeCompare(y2.agencyName));

    // 직무지도원별 rows — 매니저 화면(/manager/review) 하위호환
    const rows = workers.map(w => ({
      workerId: w.id, workerName: w.name, phoneNumber: w.phone,
      agencyName: w.agencyName, siteName: w.siteName,
      attendance: att.get(w.id) ?? { total: 0, confirmed: 0 },
      logs: log.get(w.id) ?? { total: 0, confirmed: 0 },
      evaluations: ev.get(w.id) ?? { total: 0, confirmed: 0 },
    }));

    return NextResponse.json({ success: true, yearMonth, agencies, rows });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/review]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
