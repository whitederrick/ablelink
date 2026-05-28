// app/api/admin/payroll/runs/route.ts
// GET: 급여 실행 목록 / POST: 월별 급여 계산(DRAFT 생성)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/adminScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { Decimal } from "@prisma/client/runtime/library";

const BUSINESS_DEDUCTION_RATE = 0.033; // 사업소득세 3.3%

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
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
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

    // 3개 쿼리 병렬 실행
    const [insuranceRates, agencyDeductions, assignments] = await Promise.all([
      // 4대보험 요율 조회 (해당 연도 → 없으면 최근 연도)
      prisma.insuranceRates.findFirst({
        where: { year: { lte: y } },
        orderBy: { year: "desc" },
      }),
      // 에이전시 공제 항목
      prisma.agencyDeduction.findMany({
        where: { agencyId, isActive: true },
      }),
      // 이 에이전시의 해당 월 활성 배정에 속한 직무지도원 찾기
      prisma.siteAssignment.findMany({
        where: {
          agencyId,
          status: "ACTIVE",
          startDate: { lte: new Date(periodEnd + "T23:59:59+09:00") },
          OR: [{ endDate: null }, { endDate: { gte: new Date(periodStart + "T00:00:00+09:00") } }],
        },
        select: { userId: true, siteId: true },
      }),
    ]);

    const userIds = [...new Set(assignments.map(a => a.userId))];
    if (userIds.length === 0) {
      return NextResponse.json({ success: false, message: "해당 월에 활성 직무지도원이 없습니다." }, { status: 400 });
    }

    const periodStartDate = new Date(periodStart + "T00:00:00+09:00");
    const periodEndDate = new Date(periodEnd + "T23:59:59+09:00");

    const itemInputs: {
      userId: bigint;
      grossPay: Decimal;
      totalDeduction: Decimal;
      netPay: Decimal;
      workedDays: number;
      workedMinutes: number;
      breakdown: object;
    }[] = [];

    // 유저별 3개 쿼리를 모든 유저에 걸쳐 동시 실행
    const userDataList = await Promise.all(userIds.map(async (userId) => {
      const userSiteIds = assignments.filter(a => a.userId === userId).map(a => a.siteId);
      const [contract, attendances, traineeCount] = await Promise.all([
        // 유효 급여 계약 조회
        prisma.payContract.findFirst({
          where: {
            agencyId, userId,
            effectiveFrom: { lte: new Date(periodStart) },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodEnd) } }],
          },
          orderBy: { effectiveFrom: "desc" },
        }),
        // 출근 기록 조회
        prisma.dailyAttendance.findMany({
          where: { userId, workDate: { gte: periodStart, lte: periodEnd }, isFinalClosed: true, assignment: { agencyId } },
          select: { workDate: true, startTime: true, endTime: true },
        }),
        // 훈련생 수
        prisma.traineePlacement.count({
          where: {
            siteId: { in: userSiteIds }, status: "ACTIVE",
            startDate: { lte: periodEndDate },
            OR: [{ endDate: null }, { endDate: { gte: periodStartDate } }],
          },
        }),
      ]);
      return { userId, contract, attendances, traineeCount };
    }));

    for (const { userId, contract, attendances, traineeCount } of userDataList) {
      const workedDays = attendances.length;
      const workedMinutes = attendances.reduce((s, a) => s + minutesBetween(a.startTime, a.endTime), 0);

      let grossPay = 0;
      let breakdown: Record<string, unknown> = { note: "급여 계약 없음", workedDays, workedMinutes };

      if (contract) {
        const use2PlusRate = traineeCount >= 2 && contract.hourlyRate2Plus != null;
        const rate = use2PlusRate
          ? Number(contract.hourlyRate2Plus)
          : Number(contract.baseAmount);

        if (contract.payType === "HOURLY") {
          grossPay = Math.round((workedMinutes / 60) * rate);
          breakdown = {
            payType: "HOURLY",
            hourlyRate: rate,
            traineeCount,
            used2PlusRate: use2PlusRate,
            workedMinutes,
            workedHours: +(workedMinutes / 60).toFixed(2),
            workedDays,
          };
        } else if (contract.payType === "DAILY") {
          grossPay = workedDays * rate;
          breakdown = { payType: "DAILY", dailyRate: rate, workedDays };
        } else {
          grossPay = rate;
          breakdown = { payType: "MONTHLY", monthlyRate: rate, workedDays };
        }

        // 주휴수당 가산
        const holidayPay = contract.weeklyHolidayPay ? Number(contract.weeklyHolidayPay) : 0;
        if (holidayPay > 0) {
          grossPay += holidayPay;
          (breakdown as any).weeklyHolidayPay = holidayPay;
        }
      }

      // 공제 계산
      let totalDeduction = 0;
      const deductionBreakdown: Record<string, number> = {};
      const incomeType = contract?.incomeType ?? "BUSINESS";

      if (incomeType === "BUSINESS") {
        const d = Math.round(grossPay * BUSINESS_DEDUCTION_RATE);
        deductionBreakdown["사업소득세(3.3%)"] = d;
        totalDeduction += d;
      } else {
        // 근로소득 4대보험 (근로자 부담분)
        if (insuranceRates) {
          const pension = Math.round(grossPay * Number(insuranceRates.nationalPension));
          const health = Math.round(grossPay * Number(insuranceRates.healthInsurance));
          const ltc = Math.round(grossPay * Number(insuranceRates.longTermCare));
          const employ = Math.round(grossPay * Number(insuranceRates.employmentInsurance));
          deductionBreakdown["국민연금"] = pension;
          deductionBreakdown["건강보험"] = health;
          deductionBreakdown["장기요양보험"] = ltc;
          deductionBreakdown["고용보험"] = employ;
          totalDeduction += pension + health + ltc + employ;
        }
      }

      // 에이전시 커스텀 공제
      for (const ded of agencyDeductions) {
        const amount =
          ded.type === "PERCENTAGE"
            ? Math.round(grossPay * Number(ded.amount))
            : Math.round(Number(ded.amount));
        deductionBreakdown[ded.name] = amount;
        totalDeduction += amount;
      }

      const netPay = grossPay - totalDeduction;

      itemInputs.push({
        userId,
        grossPay: new Decimal(grossPay),
        totalDeduction: new Decimal(totalDeduction),
        netPay: new Decimal(netPay),
        workedDays,
        workedMinutes,
        breakdown: { ...breakdown, incomeType, deductionBreakdown },
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
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
