export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { requireManagerSession } from "@/lib/managerScope";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);

    const { searchParams } = new URL(req.url);
    const yearMonth = searchParams.get("yearMonth") ?? "";
    if (!/^\d{4}-\d{2}$/.test(yearMonth))
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });

    const [y, m] = yearMonth.split("-").map(Number);
    const dateFrom = `${yearMonth}-01`;
    const dateTo   = `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`;

    const assignments = await prisma.siteAssignment.findMany({
      where: {
        agencyId: scope.agencyId,
        status:   { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] },
      },
      select: {
        id:   true,
        user: { select: { id: true, userName: true, phoneNumber: true } },
        site: { select: { companyName: true } },
      },
      orderBy: { assignedAt: "desc" },
    });

    const seen  = new Set<string>();
    const users = assignments.filter(a => {
      const key = a.user.id.toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (users.length === 0) return NextResponse.json({ success: true, yearMonth, rows: [] });

    const uids = users.map(u => u.user.id);

    const [attRows, logRows, evalRows] = await Promise.all([
      prisma.dailyAttendance.findMany({
        where: { userId: { in: uids }, workDate: { gte: dateFrom, lte: dateTo }, startTime: { not: null } },
        select: { userId: true, isFinalClosed: true, isManagerFinalClosed: true, managerFinalAt: true },
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

    type Counts = { total: number; confirmed: number };
    function makeCounts(ids: bigint[]): Map<string, Counts> {
      return new Map(ids.map(id => [id.toString(), { total: 0, confirmed: 0 }]));
    }
    const attMap  = makeCounts(uids);
    const logMap  = makeCounts(uids);
    const evalMap = makeCounts(uids);
    const lockMap = new Map<string, { locked: boolean; managerFinalAt: Date | null }>(
      uids.map(id => [id.toString(), { locked: false, managerFinalAt: null }])
    );

    for (const r of attRows) {
      const uid = r.userId.toString();
      const c   = attMap.get(uid);
      if (c) { c.total++; if (r.isFinalClosed) c.confirmed++; }
      if (r.isManagerFinalClosed) lockMap.set(uid, { locked: true, managerFinalAt: r.managerFinalAt ?? null });
    }
    for (const r of logRows)  { const c = logMap.get(r.writerId.toString());  if (c) { c.total++; if (r.isCompleted)  c.confirmed++; } }
    for (const r of evalRows) { const c = evalMap.get(r.writerId.toString()); if (c) { c.total++; if (r.isConfirmed)  c.confirmed++; } }

    const rows = users.map(({ user, site }) => {
      const uid  = user.id.toString();
      const lock = lockMap.get(uid) ?? { locked: false, managerFinalAt: null };
      return {
        userId:               uid,
        userName:             user.userName,
        phoneNumber:          user.phoneNumber,
        siteName:             site?.companyName ?? "-",
        attendance:           attMap.get(uid)  ?? { total: 0, confirmed: 0 },
        logs:                 logMap.get(uid)  ?? { total: 0, confirmed: 0 },
        evaluations:          evalMap.get(uid) ?? { total: 0, confirmed: 0 },
        isManagerFinalLocked: lock.locked,
        managerFinalAt:       lock.managerFinalAt?.toISOString() ?? null,
      };
    });

    return NextResponse.json({ success: true, yearMonth, rows });
  } catch (e: any) {
    if (e instanceof Response) return e;
    console.error("[admin/review]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
