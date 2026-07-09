// app/api/admin/payroll/contracts/backfill/route.ts
// 급여 기준 일괄 생성 — 서명된 근로계약서가 있는데 급여 기준이 없는 직무지도원에게
// 계약 임금정보(시급/급여형태/기간)로 급여 기준을 일괄 생성. (계약 서명 시 자동생성과 동일 로직)
// 소득유형·내부외부는 급여 계산 시 자동 판정하므로 기본값(EMPLOYMENT/EXTERNAL)으로 둔다.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) return NextResponse.json({ success: false, message: "위탁기관 정보 없음" }, { status: 403 });

    // 서명/완료된 근로계약서 중 임금정보가 있는 것(최신 우선)
    const contracts = await prisma.employmentContract.findMany({
      where: { agencyId, status: { in: ["SIGNED", "COMPLETED"] }, wageAmount: { not: null } },
      orderBy: { contractStart: "desc" },
      select: { workerId: true, wageType: true, wageAmount: true, contractStart: true, contractEnd: true },
    });

    // 워커별 최신 계약 1건만
    const latestByWorker = new Map<string, (typeof contracts)[number]>();
    for (const c of contracts) {
      const k = c.workerId.toString();
      if (!latestByWorker.has(k)) latestByWorker.set(k, c);
    }

    let created = 0;
    let skipped = 0;
    for (const c of latestByWorker.values()) {
      const wt = c.wageType;
      if (!(wt === "HOURLY" || wt === "DAILY" || wt === "MONTHLY") || c.wageAmount == null) { skipped++; continue; }
      // 계약 기간과 겹치는 급여 기준이 이미 있으면 건너뜀
      const exists = await prisma.payContract.findFirst({
        where: {
          // 기관 기본 계약(siteId=null)만 존재확인 — 현장 override만 있는 고아 상태에서 기본계약 시딩 누락 방지(A3).
          agencyId, workerId: c.workerId, siteId: null,
          effectiveFrom: { lte: c.contractEnd },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: c.contractStart } }],
        } as any,
        select: { id: true },
      });
      if (exists) { skipped++; continue; }

      const base = c.wageAmount;
      const payData: any = {
        agencyId,
        workerId: c.workerId,
        workerType: "EXTERNAL",
        payType: wt,
        baseAmount: base,
        currency: "KRW",
        incomeType: "EMPLOYMENT",
        hourlyRate2Plus: wt === "HOURLY" ? Math.round(base * 1.2) : null,
        // P1-12: 시급×8h 고정 시드는 단시간 워커 과지급 → null(급여엔진 비례 자동산정).
        weeklyHolidayPay: null,
        effectiveFrom: c.contractStart,
        effectiveTo: c.contractEnd,
      };
      await prisma.payContract.create({ data: payData });
      created++;
    }

    return NextResponse.json({ success: true, created, skipped, candidates: latestByWorker.size });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
