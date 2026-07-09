// app/api/admin/payroll/runs/route.ts
// GET: 급여 실행 목록 / POST: 월별 급여 계산(DRAFT 생성)
// 계산 로직은 lib/payroll/computeRun.ts(computePayrollItems)로 추출 — 매월 자동 크론과 공유.

export const runtime = "nodejs";
// PERF-6: 급여 계산은 동기 처리라 기관 규모↑ 시 기본 타임아웃에 걸릴 수 있다. 상한을 늘려 타임아웃을
//  방어하고(아래 계측 로그로 임계 관찰), 향후 규모가 더 커지면 작업테이블/큐로 전환한다.
export const maxDuration = 60;

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { computePayrollItems } from "@/lib/payroll/computeRun";
import { audit } from "@/lib/audit";

export async function GET(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    const where = { agencyId };
    const runs = await prisma.payrollRun.findMany({
      where,
      include: { items: { select: { id: true } } },
      orderBy: { yearMonth: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: runs.map(r => ({
        id: r.id.toString(),
        yearMonth: r.yearMonth,
        status: r.status,
        itemCount: r.items.length,
        createdAt: r.createdAt.toISOString(),
        finalizedAt: r.finalizedAt?.toISOString() ?? null,
      })),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireManagerSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "위탁기관 정보 없음" }, { status: 403 });
    }

    const planCheck = await checkAgencyPlanAccess(agencyId, "PAYROLL");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }

    const { yearMonth } = await req.json();
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });
    }

    // 기존 DRAFT 있으면 삭제 후 재계산 (트랜잭션으로 원자적 처리)
    const existing = await prisma.payrollRun.findUnique({ where: { agencyId_yearMonth: { agencyId, yearMonth } } });
    if (existing?.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
    }

    // 급여 계산(소득유형·4대보험 자동 판정 포함) — 크론과 동일 로직.
    const _t0 = Date.now();
    const { items, userCount } = await computePayrollItems(agencyId, yearMonth);
    const _durMs = Date.now() - _t0;
    // PERF-6 관찰성: 계산이 느려지면(대형 기관) 임계를 로그로 남겨 큐 전환 시점을 판단한다.
    if (_durMs > 5000 || userCount > 80) {
      console.warn(`[payroll/runs] 대형 급여계산 — agency=${agencyId} ym=${yearMonth} users=${userCount} ${_durMs}ms`);
    }
    if (userCount === 0) {
      return NextResponse.json({ success: false, message: "해당 월에 활성 직무지도원이 없습니다." }, { status: 400 });
    }

    const run = await prisma.$transaction(async (tx) => {
      // 확인(위 findUnique)과 삭제 사이에 다른 요청이 확정할 수 있으므로 트랜잭션 안에서 상태 재확인 후 삭제.
      //  (재확인 없이 id로만 삭제하면 그 사이 FINALIZED된 run을 지우고 DRAFT로 덮어쓰는 경합이 생김.)
      const cur = await tx.payrollRun.findUnique({
        where: { agencyId_yearMonth: { agencyId, yearMonth } },
        select: { id: true, status: true },
      });
      if (cur?.status === "FINALIZED") {
        throw NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
      }
      if (cur) {
        // 조건부 삭제 — 재확인(위)과 삭제 사이에 다른 요청이 FINALIZED로 만들면 0건 삭제→409(확정 급여 보호).
        const del = await tx.payrollRun.deleteMany({ where: { id: cur.id, status: { not: "FINALIZED" } } });
        if (del.count === 0) {
          throw NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
        }
      }
      return tx.payrollRun.create({
        data: { agencyId, yearMonth, status: "DRAFT", items: { create: items } },
        include: { items: { include: { user: { select: { id: true, workerName: true } } } } },
      });
    });

    await audit(scope, { entityType: "PayrollRun", entityId: run.id, action: "create", after: { yearMonth, status: "DRAFT", itemCount: run.items.length } });
    return NextResponse.json({
      success: true,
      id: run.id.toString(),
      yearMonth: run.yearMonth,
      itemCount: run.items.length,
      items: run.items.map(i => ({
        id: i.id.toString(),
        workerId: i.workerId.toString(),
        workerName: i.user.workerName,
        grossPay: Number(i.grossPay),
        totalDeduction: Number(i.totalDeduction),
        netPay: Number(i.netPay),
        workedDays: i.workedDays,
        workedMinutes: i.workedMinutes,
        breakdown: i.breakdown,
      })),
    });
  } catch (e: any) {
    if (e && typeof e.status === "number") return e as any;
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
