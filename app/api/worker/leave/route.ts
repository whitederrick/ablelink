// app/api/worker/leave/route.ts
// 직무지도원 본인 연차 조회(읽기 전용) — 기관별 잔여·발생/사용 이력. 등록·정정은 위탁기관 담당자만(정책).

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";

const KIND_LABEL: Record<string, string> = {
  ACCRUAL_MONTHLY: "발생(개근)", ACCRUAL_ANNUAL: "발생(연차년도)", USE: "사용", EXPIRE: "소멸", PAYOUT: "수당 정산", ADJUST: "조정",
};

export async function GET(req: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(req);
    if (!session) return NextResponse.json({ success: false, message: "인증 필요" }, { status: 401 });
    const workerId = BigInt(session.workerId);

    const rows = await prisma.annualLeaveEntry.findMany({
      where: { workerId },
      orderBy: [{ effectiveDate: "desc" }, { id: "desc" }],
      select: {
        agencyId: true, kind: true, days: true, effectiveDate: true, expiresAt: true, sourceLabel: true, memo: true,
        agency: { select: { name: true } },
      },
    });

    // 기관별 그룹(연차는 근로계약=기관 단위 권리)
    const byAgency = new Map<string, { agencyName: string; balance: number; entries: unknown[] }>();
    for (const r of rows) {
      const k = r.agencyId.toString();
      const g = byAgency.get(k) ?? { agencyName: r.agency?.name ?? "-", balance: 0, entries: [] };
      g.balance += Number(r.days);
      if (g.entries.length < 30) {
        g.entries.push({
          kind: r.kind,
          kindLabel: KIND_LABEL[r.kind] ?? r.kind,
          days: Number(r.days),
          effectiveDate: r.effectiveDate.toISOString().slice(0, 10),
          expiresAt: r.expiresAt ? r.expiresAt.toISOString().slice(0, 10) : null,
          label: r.sourceLabel || r.memo || null,
        });
      }
      byAgency.set(k, g);
    }
    const groups = [...byAgency.entries()].map(([agencyId, g]) => ({
      agencyId, agencyName: g.agencyName,
      balance: Math.round(g.balance * 100) / 100,
      entries: g.entries,
    }));
    return NextResponse.json({ success: true, groups });
  } catch (e: unknown) {
    console.error("[worker/leave]", e);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
