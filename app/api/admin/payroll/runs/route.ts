// app/api/admin/payroll/runs/route.ts
// GET: 급여 실행 목록 / POST: 월별 급여 계산(DRAFT 생성)

export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireManagerSession } from "@/lib/managerScope";
import { checkAgencyPlanAccess } from "@/lib/planGuard";
import { isPayrollPending } from "@/lib/attendance/payrollGate";
import { computeWeeklyHoliday, scheduledMinutesForWorkType } from "@/lib/payroll/weeklyHoliday";
import { Decimal } from "@prisma/client/runtime/library";

const BUSINESS_DEDUCTION_RATE = 0.033; // 사업소득세 3.3%

function minutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

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

    // 기존 DRAFT 있으면 삭제 후 재계산 (트랜잭션으로 원자적 처리)
    const existing = await prisma.payrollRun.findUnique({ where: { agencyId_yearMonth: { agencyId, yearMonth } } });
    if (existing?.status === "FINALIZED") {
      return NextResponse.json({ success: false, message: "이미 확정된 급여입니다. 수정할 수 없습니다." }, { status: 409 });
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
        select: { workerId: true, siteId: true },
      }),
    ]);

    const userIds = [...new Set(assignments.map(a => a.workerId))];
    if (userIds.length === 0) {
      return NextResponse.json({ success: false, message: "해당 월에 활성 직무지도원이 없습니다." }, { status: 400 });
    }

    const periodStartDate = new Date(periodStart + "T00:00:00+09:00");
    const periodEndDate = new Date(periodEnd + "T23:59:59+09:00");

    const itemInputs: {
      workerId: bigint;
      grossPay: Decimal;
      totalDeduction: Decimal;
      netPay: Decimal;
      workedDays: number;
      workedMinutes: number;
      breakdown: object;
    }[] = [];

    // 유저별 3개 쿼리를 모든 유저에 걸쳐 동시 실행
    const userDataList = await Promise.all(userIds.map(async (workerId) => {
      const userSiteIds = assignments.filter(a => a.workerId === workerId).map(a => a.siteId);
      const [contract, attendances, traineeCount, empContract] = await Promise.all([
        // 유효 급여 계약 조회
        prisma.payContract.findFirst({
          where: {
            agencyId, workerId,
            effectiveFrom: { lte: new Date(periodStart) },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodEnd) } }],
          },
          orderBy: { effectiveFrom: "desc" },
        }),
        // 출근 기록 조회 (게이트 판정용 실제시각·확정여부·근무형태 + 연장시간용 logs 포함)
        prisma.dailyAttendance.findMany({
          where: { workerId, workDate: { gte: periodStart, lte: periodEnd }, isFinalClosed: true, assignment: { agencyId } },
          select: {
            workDate: true, startTime: true, endTime: true,
            actualStartTime: true, payrollConfirmedAt: true,
            assignment: { select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true } },
            logs: { select: { extTime1on1: true, extTimeGroup: true } },
          },
        }),
        // 훈련생 수
        prisma.traineePlacement.count({
          where: {
            siteId: { in: userSiteIds }, status: "ACTIVE",
            startDate: { lte: periodEndDate },
            OR: [{ endDate: null }, { endDate: { gte: periodStartDate } }],
          },
        }),
        // 근로계약서(주휴 소정근로일수 출처) — 해당 월 겹치는 계약 최신
        prisma.employmentContract.findFirst({
          where: {
            agencyId, workerId,
            contractStart: { lte: periodEndDate },
            contractEnd: { gte: periodStartDate },
          },
          orderBy: { contractStart: "desc" },
          select: { workDaysPerWeek: true },
        }),
      ]);
      return { workerId, contract, attendances, traineeCount, empContract };
    }));

    for (const { workerId, contract, attendances, traineeCount, empContract } of userDataList) {
      // 급여 게이트: 심한 지각 미컨펌(보정대기) 날은 급여 산정에서 제외(출근부 PDF와 동일 기준).
      const confirmedAtt = attendances.filter((a) => !isPayrollPending({
        actualStartTime: a.actualStartTime ?? null,
        payrollConfirmedAt: a.payrollConfirmedAt ?? null,
        workType: a.assignment?.workType ?? null,
        commuteGuidanceIncluded: a.assignment?.commuteGuidanceIncluded ?? null,
        customWorkStart: a.assignment?.customWorkStart ?? null,
        customWorkEnd: a.assignment?.customWorkEnd ?? null,
        exempt: a.assignment?.attendanceButtonExempt ?? false,
      }));
      const pendingDays = attendances.length - confirmedAtt.length;

      const workedDays = confirmedAtt.length;
      const workedMinutes = confirmedAtt.reduce((s, a) => s + minutesBetween(a.startTime, a.endTime), 0);
      const workedHours = +(workedMinutes / 60).toFixed(2);
      // 연장근로시간(h): 일지에 입력된 연장 지도시간(1:1 + 1:多) 합산.
      const overtimeHours = confirmedAtt.reduce(
        (s, a) => s + a.logs.reduce((t, l) => t + Number(l.extTime1on1) + Number(l.extTimeGroup), 0), 0);

      let grossPay = 0;
      const calcMethods: Record<string, string> = {};
      let breakdown: Record<string, unknown> = { note: "급여 계약 없음", workedDays, workedMinutes, pendingDays };

      if (contract) {
        const use2PlusRate = traineeCount >= 2 && contract.hourlyRate2Plus != null;
        const rate = use2PlusRate
          ? Number(contract.hourlyRate2Plus)
          : Number(contract.baseAmount);

        // 통상시급(연장·야간·휴일 가산 기준). 시급제=시급, 일급제=일급/평균소정근로시간, 월급제=월급/209h.
        let ordinaryWage = 0;
        if (contract.payType === "HOURLY") {
          grossPay = Math.round(workedHours * rate);
          ordinaryWage = rate;
          calcMethods["기본급"] = `${workedHours}시간 × ${rate.toLocaleString()}원`;
          breakdown = {
            payType: "HOURLY", hourlyRate: rate, traineeCount, used2PlusRate: use2PlusRate,
            workedMinutes, workedHours, workedDays, pendingDays,
          };
        } else if (contract.payType === "DAILY") {
          grossPay = workedDays * rate;
          const avgDailyH = workedDays > 0 ? workedMinutes / workedDays / 60 : 0;
          ordinaryWage = avgDailyH > 0 ? Math.round(rate / avgDailyH) : 0;
          calcMethods["기본급"] = `${workedDays}일 × ${rate.toLocaleString()}원`;
          breakdown = { payType: "DAILY", dailyRate: rate, workedDays, workedMinutes, pendingDays };
        } else {
          grossPay = rate;
          ordinaryWage = Math.round(rate / 209); // 월 소정근로시간 209h 기준
          calcMethods["기본급"] = `월 ${rate.toLocaleString()}원`;
          breakdown = { payType: "MONTHLY", monthlyRate: rate, workedDays, workedMinutes, pendingDays };
        }

        // 연장근로수당 = 연장시간 × 통상시급 × 1.5 (일지에 입력된 실제 연장 지도시간 기준)
        if (overtimeHours > 0 && ordinaryWage > 0) {
          const overtimePay = Math.round(overtimeHours * ordinaryWage * 1.5);
          grossPay += overtimePay;
          (breakdown as any).overtimeHours = overtimeHours;
          (breakdown as any).overtimePay = overtimePay;
          calcMethods["연장근로수당"] = `${overtimeHours}시간 × ${ordinaryWage.toLocaleString()}원 × 1.5`;
        }

        // 주휴수당: 근로소득(EMPLOYMENT) 단시간 근로자만 — 2조건(주 개근 + 4주평균 15h↑) 판정 후 자동 산식.
        //   소정근로는 근무형태 기준(휴게·출퇴근지도 제외). 통상시급은 위 ordinaryWage 재사용.
        //   PayContract.weeklyHolidayPay(고정액)가 있으면 수동 오버라이드.
        if (contract.incomeType === "EMPLOYMENT" && ordinaryWage > 0) {
          const days = confirmedAtt.map((a) => ({
            dateISO: a.workDate,
            scheduledMinutes: scheduledMinutesForWorkType(
              a.assignment?.workType ?? null,
              a.assignment?.customWorkStart ?? null,
              a.assignment?.customWorkEnd ?? null,
            ),
          }));
          const wh = computeWeeklyHoliday({
            days,
            workDaysPerWeek: empContract?.workDaysPerWeek ?? 5,
            ordinaryWage,
            flatWeeklyHolidayPay: contract.weeklyHolidayPay ? Number(contract.weeklyHolidayPay) : null,
          });
          if (wh.totalHolidayPay > 0) {
            grossPay += wh.totalHolidayPay;
            (breakdown as any).weeklyHolidayPay = wh.totalHolidayPay;
            (breakdown as any).weeklyHolidayDetail = {
              eligibleWeeks: wh.eligibleWeeks,
              avgWeeklyHours: +(wh.avgWeeklyMinutes / 60).toFixed(1),
              meets15h: wh.meets15h,
            };
            calcMethods["주휴수당"] = wh.calcMethod;
          }
        }

        (breakdown as any).ordinaryWage = ordinaryWage;
        (breakdown as any).calcMethods = calcMethods;
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
        workerId,
        grossPay: new Decimal(grossPay),
        totalDeduction: new Decimal(totalDeduction),
        netPay: new Decimal(netPay),
        workedDays,
        workedMinutes,
        breakdown: { ...breakdown, incomeType, deductionBreakdown },
      });
    }

    const run = await prisma.$transaction(async (tx) => {
      if (existing) await tx.payrollRun.delete({ where: { id: existing.id } });
      return tx.payrollRun.create({
        data: { agencyId, yearMonth, status: "DRAFT", items: { create: itemInputs } },
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
