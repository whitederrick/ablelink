// app/api/worker/payroll/route.ts
// 직무지도원 본인 급여명세 조회 (확정된 것만)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });

    const workerId = BigInt(session.workerId);

    const items = await prisma.payrollItem.findMany({
      where: { workerId, run: { status: "FINALIZED" } },
      include: {
        run: { select: { yearMonth: true, status: true, finalizedAt: true, agency: { select: { name: true } } } },
      },
      orderBy: { run: { yearMonth: "desc" } },
    });

    return NextResponse.json({
      success: true,
      items: items.map(i => ({
        id: i.id.toString(),
        runId: i.runId.toString(),
        yearMonth: i.run.yearMonth,
        agencyName: i.run.agency?.name ?? "-",
        finalizedAt: i.run.finalizedAt?.toISOString() ?? null,
        grossPay: Number(i.grossPay),
        totalDeduction: Number(i.totalDeduction),
        netPay: Number(i.netPay),
        workedDays: i.workedDays ?? 0,
        workedMinutes: i.workedMinutes ?? 0,
        breakdown: i.breakdown ?? {},
      })),
    });
  } catch (e: any) {
    console.error("[worker/payroll]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
