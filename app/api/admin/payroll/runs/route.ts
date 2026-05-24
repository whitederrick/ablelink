// app/api/admin/payroll/runs/route.ts
// GET: 급여 실행 목록 / POST: 월별 급여 계산(DRAFT 생성)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { Decimal } from "@prisma/client/runtime/library";

const DEDUCTION_RATE = 0.033; // 단기 시간제 사업소득세 3.3%

function minutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export async function GET(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId && scope.role !== "ADMIN") {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const where = agencyId ? { agencyId } : {};
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
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const scope = await requireAdminSession(req);
    const agencyId = scope.agencyId;
    if (!agencyId) {
      return NextResponse.json({ success: false, message: "에이전시 정보 없음" }, { status: 403 });
    }

    const planCheck = await checkAgencyPlanAccess(agencyId, "PAYROLL");
    if (!planCheck.allowed) {
      return NextResponse.json({ success: false, message: planCheck.message, reason: planCheck.reason }, { status: 403 });
    }

    const { yearMonth } = await req.json();
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ success: false, message: "yearMonth 형식 오류 (YYYY-MM)" }, { status: 400 });
    }

    // 기존 DRAFT 있으면 삭제 후 재계산
    const existing = await prisma.payrollRun.findUnique({ where: { agencyId_yearMonth: { agencyId, yearMonth } } });
    if (existing?.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
    }
    if (existing) {
      await prisma.payrollRun.delete({ where: { id: existing.id } });
    }

    const [y, m] = yearMonth.split("-").map(Number);
    const periodStart = `${yearMonth}-01`;
    const periodEnd = `${yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;

    // 이 에이전시의 해당 월 활성 배정에 속한 직무지도원 찾기
    const assignments = await prisma.siteAssignment.findMany({
      where: {
        agencyId,
        status: "ACTIVE",
        startDate: { lte: new Date(periodEnd + "T23:59:59+09:00") },
        OR: [{ endDate: null }, { endDate: { gte: new Date(periodStart + "T00:00:00+09:00") } }],
      },
      select: { userId: true },
    });

    const userIds = [...new Set(assignments.map(a => a.userId))];
    if (userIds.length === 0) {
      return NextResponse.json({ success: false, message: "해당 월에 활성 직무지도원이 없습니다." }, { status: 400 });
    }

    // 직무지도원별 계산
    const itemInputs: {
      userId: bigint;
      grossPay: Decimal;
      totalDeduction: Decimal;
      netPay: Decimal;
      workedDays: number;
      workedMinutes: number;
      breakdown: object;
    }[] = [];

    for (const userId of userIds) {
      // 유효 급여 계약 조회
      const contract = await prisma.payContract.findFirst({
        where: {
          agencyId,
          userId,
          effectiveFrom: { lte: new Date(periodStart) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodEnd) } }],
        },
        orderBy: { effectiveFrom: "desc" },
      });

      // 출근 기록 조회
      const attendances = await prisma.dailyAttendance.findMany({
        where: {
          userId,
          workDate: { gte: periodStart, lte: periodEnd },
          isFinalClosed: true,
          assignment: { agencyId },
        },
        select: { workDate: true, startTime: true, endTime: true },
      });

      const workedDays = attendances.length;
      const workedMinutes = attendances.reduce((s, a) => s + minutesBetween(a.startTime, a.endTime), 0);

      let grossPay = 0;
      let breakdown: object = { note: "급여 계약 없음", workedDays, workedMinutes };

      if (contract) {
        const rate = Number(contract.baseAmount);
        if (contract.payType === "HOURLY") {
          grossPay = Math.round((workedMinutes / 60) * rate);
          breakdown = { payType: "HOURLY", hourlyRate: rate, workedMinutes, workedHours: +(workedMinutes / 60).toFixed(2), workedDays };
        } else if (contract.payType === "DAILY") {
          grossPay = workedDays * rate;
          breakdown = { payType: "DAILY", dailyRate: rate, workedDays };
        } else {
          grossPay = rate;
          breakdown = { payType: "MONTHLY", monthlyRate: rate, workedDays };
        }
      }

      const totalDeduction = Math.round(grossPay * DEDUCTION_RATE);
      const netPay = grossPay - totalDeduction;

      itemInputs.push({
        userId,
        grossPay: new Decimal(grossPay),
        totalDeduction: new Decimal(totalDeduction),
        netPay: new Decimal(netPay),
        workedDays,
        workedMinutes,
        breakdown,
      });
    }

    const run = await prisma.payrollRun.create({
      data: {
        agencyId,
        yearMonth,
        status: "DRAFT",
        items: { create: itemInputs },
      },
      include: { items: { include: { user: { select: { id: true, userName: true } } } } },
    });

    return NextResponse.json({
      success: true,
      id: run.id.toString(),
      yearMonth: run.yearMonth,
      itemCount: run.items.length,
      items: run.items.map(i => ({
        id: i.id.toString(),
        userId: i.userId.toString(),
        userName: i.user.userName,
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
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
