// app/api/admin/payroll/runs/route.ts
// GET: 급여 실행 목록 / POST: 월별 급여 계산(DRAFT 생성)
// 계산 로직은 lib/payroll/computeRun.ts(computePayrollItems)로 추출 — 매월 자동 크론과 공유.

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { computePayrollItems } from "@/lib/payroll/computeRun";

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
    const { items, userCount } = await computePayrollItems(agencyId, yearMonth);
    if (userCount === 0) {
      return NextResponse.json({ success: false, message: "해당 월에 활성 직무지도원이 없습니다." }, { status: 400 });
    }

    const run = await prisma.$transaction(async (tx) => {
      if (existing) await tx.payrollRun.delete({ where: { id: existing.id } });
      return tx.payrollRun.create({
        data: { agencyId, yearMonth, status: "DRAFT", items: { create: items } },
        include: { items: { include: { user: { select: { id: true, workerName: true } } } } },
      });
    });

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
