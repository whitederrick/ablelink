// lib/payroll/computeRun.ts
// 월별 급여 계산(읽기 전용) — 에이전시·연월로 PayrollItem 입력값 배열을 산출한다.
// DB에 쓰지 않는다(생성은 호출측 트랜잭션). **급여 계산의 단일 소스** —
// 수동 계산(app/api/admin/payroll/runs POST)과 매월 자동 크론(cron/daily)이 모두 이 함수를 사용.

import { prisma } from "@/lib/prisma";
import { isPayrollPending } from "@/lib/attendance/payrollGate";
import { computeWeeklyHoliday } from "@/lib/payroll/weeklyHoliday";
import { getKrHolidays } from "@/lib/krHolidays";
import { computeIncomeTax, type TaxBracket } from "@/lib/payroll/incomeTax";
import { determineEligibility } from "@/lib/payroll/insuranceEligibility";
import { Decimal } from "@prisma/client/runtime/library";

const SERVICE_STEP_LABEL: Record<string, string> = {
  PRE_TRAINING: "사전훈련", FIELD_TRAINING: "지원고용 현장훈련", ADAPTATION: "취업 후 적응지도",
};
const BUSINESS_DEDUCTION_RATE = 0.033; // 사업소득세 3.3%
const DAY_MS = 86400000;

function minutesBetween(start: Date | null, end: Date | null): number {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}
// 포함 일수(시작·종료 당일 포함). 보험 판정의 고용기간·계속근로 산정용.
function spanDays(start: Date, end: Date): number {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

export type PayrollItemInput = {
  workerId: bigint;
  grossPay: Decimal;
  totalDeduction: Decimal;
  netPay: Decimal;
  workedDays: number;
  workedMinutes: number;
  breakdown: object;
};

/**
 * 해당 에이전시·연월의 급여 항목을 계산해 반환(DB 미반영).
 * 소득유형·4대보험은 근로계약·근태·고용기간으로 자동 판정(산재=사업주 부담, 워커 공제 제외).
 */
export async function computePayrollItems(
  agencyId: bigint,
  yearMonth: string,
): Promise<{ items: PayrollItemInput[]; userCount: number }> {
  const [y, m] = yearMonth.split("-").map(Number);
  const periodStart = `${yearMonth}-01`;
  const periodEnd = `${yearMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const periodStartDate = new Date(periodStart + "T00:00:00+09:00");
  const periodEndDate = new Date(periodEnd + "T23:59:59+09:00");

  const [insuranceRates, agencyDeductions, assignments, incomeTaxRow] = await Promise.all([
    prisma.insuranceRates.findFirst({ where: { year: { lte: y } }, orderBy: { year: "desc" } }),
    prisma.agencyDeduction.findMany({ where: { agencyId, isActive: true } }),
    prisma.siteAssignment.findMany({
      where: {
        agencyId,
        status: "ACTIVE",
        startDate: { lte: new Date(periodEnd + "T23:59:59+09:00") },
        OR: [{ endDate: null }, { endDate: { gte: new Date(periodStart + "T00:00:00+09:00") } }],
      },
      select: { workerId: true, siteId: true, serviceStep: true, startDate: true },
    }),
    prisma.incomeTaxTable.findFirst({ where: { year: { lte: y } }, orderBy: { year: "desc" } }),
  ]);
  const taxBrackets: TaxBracket[] = Array.isArray(incomeTaxRow?.data) ? (incomeTaxRow!.data as any) : [];
  const taxChildCredit = (incomeTaxRow?.meta as any)?.childCredit;

  const userIds = [...new Set(assignments.map((a) => a.workerId))];
  if (userIds.length === 0) return { items: [], userCount: 0 };

  const itemInputs: PayrollItemInput[] = [];

  const userDataList = await Promise.all(userIds.map(async (workerId) => {
    const userSiteIds = assignments.filter((a) => a.workerId === workerId).map((a) => a.siteId);
    const [contract, attendances, traineeCount, empContract, firstContract] = await Promise.all([
      prisma.payContract.findFirst({
        where: {
          agencyId, workerId,
          effectiveFrom: { lte: new Date(periodStart) },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodEnd) } }],
        },
        orderBy: { effectiveFrom: "desc" },
      }),
      prisma.dailyAttendance.findMany({
        where: { workerId, workDate: { gte: periodStart, lte: periodEnd }, isFinalClosed: true, assignment: { agencyId } },
        select: {
          workDate: true, startTime: true, endTime: true,
          actualStartTime: true, actualEndTime: true, payrollConfirmedAt: true,
          assignment: { select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true } },
          logs: { select: { extTime1on1: true, extTimeGroup: true } },
        },
      }),
      prisma.traineePlacement.count({
        where: {
          siteId: { in: userSiteIds }, status: "ACTIVE",
          startDate: { lte: periodEndDate },
          OR: [{ endDate: null }, { endDate: { gte: periodStartDate } }],
        },
      }),
      prisma.employmentContract.findFirst({
        where: { agencyId, workerId, contractStart: { lte: periodEndDate }, contractEnd: { gte: periodStartDate } },
        orderBy: { contractStart: "desc" },
        select: { workDaysPerWeek: true, weeklyHoliday: true, contractStart: true, contractEnd: true, workStartTime: true, workEndTime: true, breakStartTime: true, breakEndTime: true },
      }),
      prisma.employmentContract.findFirst({
        where: { agencyId, workerId },
        orderBy: { contractStart: "asc" },
        select: { contractStart: true },
      }),
    ]);
    return { workerId, contract, attendances, traineeCount, empContract, firstContract };
  }));

  for (const { workerId, contract, attendances, traineeCount, empContract, firstContract } of userDataList) {
    // 급여 게이트: 심한 지각 미컨펌(보정대기) 날은 급여 산정에서 제외(출근부 PDF와 동일 기준).
    const confirmedAtt = attendances.filter((a) => !isPayrollPending({
      actualStartTime: a.actualStartTime ?? null,
      actualEndTime: a.actualEndTime ?? null,
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
    // HOURLY 지급시간 = 출근 span에서 무급 휴게만 제외.
    //  · 전일(FULL_DAY): 8h 한도 → 출퇴근·휴게 지도수당 없음, 휴게 60분 제외(9h→8h)
    //  · 오전/오후(AM/PM): 5.5h(출근30+퇴근30+휴게지도30 포함) = span 그대로
    //  · CUSTOM 4h↑: 통상 휴게 30분 제외
    const unpaidBreakMin = (wt: string | null | undefined, span: number) =>
      (wt === "FULL_DAY" ? 60 : (wt === "CUSTOM" && span >= 240 ? 30 : 0));
    const paidMinutes = confirmedAtt.reduce((s, a) => {
      const span = minutesBetween(a.startTime, a.endTime);
      return s + Math.max(0, span - unpaidBreakMin(a.assignment?.workType, span));
    }, 0);
    const paidHours = +(paidMinutes / 60).toFixed(2);
    // 1일 소정근로시간(분) = 근로계약서 시업~종업 − 휴게. 주휴·보험 판정의 기준(약정시간). 없으면 출근부 기반 폴백.
    const cMin = (t?: string | null) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
    const _cs = cMin(empContract?.workStartTime), _ce = cMin(empContract?.workEndTime), _cbs = cMin(empContract?.breakStartTime), _cbe = cMin(empContract?.breakEndTime);
    const contractDailySojeMin = (_cs != null && _ce != null && _ce > _cs)
      ? Math.max(0, (_ce - _cs) - (_cbs != null && _cbe != null && _cbe > _cbs ? _cbe - _cbs : 0))
      : null;
    const overtimeHours = confirmedAtt.reduce(
      (s, a) => s + a.logs.reduce((t, l) => t + Number(l.extTime1on1) + Number(l.extTimeGroup), 0), 0);

    let grossPay = 0;
    const calcMethods: Record<string, string> = {};
    let breakdown: Record<string, unknown> = { note: "급여 계약 없음", workedDays, workedMinutes, pendingDays };

    if (contract) {
      const use2PlusRate = traineeCount >= 2 && contract.hourlyRate2Plus != null;
      const rate = use2PlusRate ? Number(contract.hourlyRate2Plus) : Number(contract.baseAmount);

      let ordinaryWage = 0;
      if (contract.payType === "HOURLY") {
        grossPay = Math.round(paidHours * rate);
        ordinaryWage = rate;
        calcMethods["기본급"] = `${paidHours}시간 × ${rate.toLocaleString()}원 (휴게 제외)`;
        breakdown = { payType: "HOURLY", hourlyRate: rate, traineeCount, used2PlusRate: use2PlusRate, workedMinutes, workedHours, paidMinutes, paidHours, workedDays, pendingDays };
      } else if (contract.payType === "DAILY") {
        grossPay = workedDays * rate;
        // 통상시급 = 일급 ÷ 1일 평균 (무급)휴게 제외 근로시간. (연장·주휴 가산 기준)
        const avgDailyH = workedDays > 0 ? paidMinutes / workedDays / 60 : 0;
        ordinaryWage = avgDailyH > 0 ? Math.round(rate / avgDailyH) : 0;
        calcMethods["기본급"] = `${workedDays}일 × ${rate.toLocaleString()}원`;
        breakdown = { payType: "DAILY", dailyRate: rate, workedDays, workedMinutes, pendingDays };
      } else {
        grossPay = rate;
        ordinaryWage = Math.round(rate / 209); // 월 소정근로시간 209h 기준
        calcMethods["기본급"] = `월 ${rate.toLocaleString()}원`;
        breakdown = { payType: "MONTHLY", monthlyRate: rate, workedDays, workedMinutes, pendingDays };
      }

      if (overtimeHours > 0 && ordinaryWage > 0) {
        const overtimePay = Math.round(overtimeHours * ordinaryWage * 1.5);
        grossPay += overtimePay;
        (breakdown as any).overtimeHours = overtimeHours;
        (breakdown as any).overtimePay = overtimePay;
        calcMethods["연장근로수당"] = `${overtimeHours}시간 × ${ordinaryWage.toLocaleString()}원 × 1.5`;
      }

      // 야간(22:00~06:00)·휴일(공휴일/주휴일) 근로 자동검출 → 0.5 가산수당. (평일·주간 근무는 0)
      //  ※ 출근부 실제 시각 기준 자동 산정 — 검출 규칙은 사용자 검토 대상.
      if (ordinaryWage > 0) {
        const KST = 9 * 3600 * 1000;
        const kstMin = (d: Date) => Math.floor(((d.getTime() + KST) % 86400000) / 60000);
        const ovl = (s: number, e: number, a: number, b: number) => Math.max(0, Math.min(e, b) - Math.max(s, a));
        const DOW: Record<string, number> = { "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6 };
        const whDow = empContract?.weeklyHoliday ? (DOW[empContract.weeklyHoliday] ?? 0) : 0; // 주휴일 요일(기본 일)
        const holidaySet = new Set(Object.keys(getKrHolidays(y, m)));
        let nightMin = 0, holidayMin = 0;
        for (const a of confirmedAtt) {
          if (!a.startTime || !a.endTime) continue;
          const s = kstMin(a.startTime), e = kstMin(a.endTime);
          if (e > s) nightMin += ovl(s, e, 0, 360) + ovl(s, e, 1320, 1440); // 자정 안 넘는 경우만
          const [yy, mm2, dd] = a.workDate.split("-").map(Number);
          const dow = new Date(Date.UTC(yy, mm2 - 1, dd)).getUTCDay();
          if (holidaySet.has(a.workDate) || dow === whDow) holidayMin += Math.max(0, e - s);
        }
        if (nightMin > 0) {
          const nightHours = +(nightMin / 60).toFixed(2);
          const pay = Math.round(nightHours * ordinaryWage * 0.5);
          grossPay += pay;
          (breakdown as any).nightHours = nightHours; (breakdown as any).nightPay = pay;
          calcMethods["야간근로수당"] = `${nightHours}시간 × ${ordinaryWage.toLocaleString()}원 × 0.5`;
        }
        if (holidayMin > 0) {
          const holidayHours = +(holidayMin / 60).toFixed(2);
          const pay = Math.round(holidayHours * ordinaryWage * 0.5);
          grossPay += pay;
          (breakdown as any).holidayHours = holidayHours; (breakdown as any).holidayPay = pay;
          calcMethods["휴일근로수당"] = `${holidayHours}시간 × ${ordinaryWage.toLocaleString()}원 × 0.5`;
        }
      }

      // 주휴수당: 근로소득(EMPLOYMENT) 단시간 — 2조건 자동 산식. PayContract.weeklyHolidayPay 고정 오버라이드.
      if (contract.incomeType === "EMPLOYMENT" && ordinaryWage > 0) {
        // 소정근로시간 = 실질 약정 근로시간(출퇴근·휴게지도 포함, 무급휴게만 제외) = 지급시간과 동일.
        //  오전/오후 5.5h · 전일 8h. (주휴 = (1주 소정÷40)×8×시급)
        const days = confirmedAtt.map((a) => {
          const span = minutesBetween(a.startTime, a.endTime);
          const fallback = Math.max(0, span - unpaidBreakMin(a.assignment?.workType, span));
          return { dateISO: a.workDate, scheduledMinutes: contractDailySojeMin ?? fallback };
        });
        const wh = computeWeeklyHoliday({
          days, workDaysPerWeek: empContract?.workDaysPerWeek ?? 5, ordinaryWage,
          flatWeeklyHolidayPay: contract.weeklyHolidayPay ? Number(contract.weeklyHolidayPay) : null,
        });
        if (wh.totalHolidayPay > 0) {
          grossPay += wh.totalHolidayPay;
          (breakdown as any).weeklyHolidayPay = wh.totalHolidayPay;
          (breakdown as any).weeklyHolidayDetail = { eligibleWeeks: wh.eligibleWeeks, avgWeeklyHours: +(wh.avgWeeklyMinutes / 60).toFixed(1), meets15h: wh.meets15h };
          calcMethods["주휴수당"] = wh.calcMethod;
        }
      }

      (breakdown as any).ordinaryWage = ordinaryWage;
      (breakdown as any).calcMethods = calcMethods;
    }

    // ── 지급내역 라인아이템(시드) ──
    const bd = breakdown as any;
    const owage = Number(bd.ordinaryWage ?? 0);
    const whPay = Number(bd.weeklyHolidayPay ?? 0);
    const whHours = owage > 0 ? +(whPay / owage).toFixed(1) : 0;
    const basePay = Math.round(grossPay - Number(bd.overtimePay ?? 0) - Number(bd.nightPay ?? 0) - Number(bd.holidayPay ?? 0) - whPay);
    const payLines: { key: string; name: string; hours: number; amount: number; method?: string }[] = [];
    if (bd.payType === "HOURLY") {
      const rate1 = Number(contract?.baseAmount ?? bd.hourlyRate ?? 0);
      const rate2 = contract?.hourlyRate2Plus != null ? Number(contract.hourlyRate2Plus) : Math.round(rate1 * 1.2);
      const h2 = bd.used2PlusRate ? paidHours : 0;
      const h1 = bd.used2PlusRate ? 0 : paidHours;
      payLines.push({ key: "support1", name: "1인지원", hours: h1, amount: Math.round(h1 * rate1), method: rate1 ? `지원시간 × ${rate1.toLocaleString()}원` : "" });
      payLines.push({ key: "support2", name: "2인이상지원", hours: h2, amount: Math.round(h2 * rate2), method: rate1 ? `지원시간 × ${rate1.toLocaleString()}원 × 120%` : "" });
    } else if (contract) {
      payLines.push({ key: "base", name: "기본급", hours: workedHours, amount: basePay, method: calcMethods["기본급"] ?? "" });
    }
    if (Number(bd.overtimePay ?? 0) > 0) {
      payLines.push({ key: "overtime", name: "연장근로수당", hours: Number(bd.overtimeHours ?? 0), amount: Number(bd.overtimePay), method: calcMethods["연장근로수당"] ?? "" });
    }
    if (Number(bd.nightPay ?? 0) > 0) {
      payLines.push({ key: "night", name: "야간근로수당", hours: Number(bd.nightHours ?? 0), amount: Number(bd.nightPay), method: calcMethods["야간근로수당"] ?? "" });
    }
    if (Number(bd.holidayPay ?? 0) > 0) {
      payLines.push({ key: "holiday", name: "휴일근로수당", hours: Number(bd.holidayHours ?? 0), amount: Number(bd.holidayPay), method: calcMethods["휴일근로수당"] ?? "" });
    }
    payLines.push({ key: "weeklyHoliday", name: "주휴수당", hours: whHours, amount: whPay, method: calcMethods["주휴수당"] ?? "" });
    payLines.push({ key: "paidHoliday", name: "유급휴일", hours: 0, amount: 0 });
    payLines.push({ key: "paidLeave", name: "유급연차", hours: 0, amount: 0 });
    payLines.push({ key: "education", name: "교육수당", hours: 0, amount: 0 });
    const totalHours = +((bd.payType === "HOURLY" ? paidHours : workedHours) + whHours).toFixed(1);

    // 기본사항
    const wa = assignments.find((a) => a.workerId === workerId);
    const dependents = 1;
    const childUnder20 = 0;
    const withholdingRate = 100;
    const basicInfo = {
      job: "직무지도",
      placementType: wa?.serviceStep ? (SERVICE_STEP_LABEL[wa.serviceStep] ?? "") : "",
      placementDate: wa?.startDate ? new Date(wa.startDate).toISOString().slice(0, 10) : "",
      dependents, childUnder20, withholdingRate,
    };

    // ── 소득유형·4대보험 자동 판정 ──
    // 월 소정근로시간 = 1일 소정(계약서 시업~종업−휴게) × 근로일. 없으면 지급시간(출근부) 기반. 월 60h 판정 기준.
    const monthlyHours = contractDailySojeMin != null
      ? +((contractDailySojeMin * workedDays) / 60).toFixed(1)
      : +(paidMinutes / 60).toFixed(1);
    const employmentMonths = (empContract?.contractStart && empContract?.contractEnd)
      ? spanDays(empContract.contractStart, empContract.contractEnd) / 30
      : Infinity;
    const firstStart = firstContract?.contractStart ?? empContract?.contractStart ?? periodStartDate;
    const continuousMonths = spanDays(firstStart, periodEndDate) / 30;
    const elig = determineEligibility(
      {
        hasEmploymentContract: !!empContract,
        hasAttendance: workedDays > 0,
        freelancerOverride: contract?.incomeType === "BUSINESS" && !empContract,
      },
      { employmentMonths, monthlyHours, monthlyDays: workedDays, continuousMonths },
    );

    // ── 공제 계산 ──
    let totalDeduction = 0;
    const deductionBreakdown: Record<string, number> = {};
    const deductLines: { key: string; name: string; amount: number }[] = [];
    const incomeType = elig.incomeType;
    const pushDed = (key: string, name: string, amount: number) => {
      deductionBreakdown[name] = amount;
      deductLines.push({ key, name, amount });
      totalDeduction += amount;
    };

    if (incomeType === "BUSINESS") {
      pushDed("bizTax", "사업소득세(3.3%)", Math.round(grossPay * BUSINESS_DEDUCTION_RATE));
    } else {
      const taxR = computeIncomeTax(taxBrackets, grossPay, dependents, { childUnder20, rate: withholdingRate, childCredit: taxChildCredit });
      pushDed("incomeTax", "소득세", taxR.tax);
      pushDed("localTax", "주민세", taxR.localTax);
      if (insuranceRates) {
        const ded = new Set(elig.workerDeductible);
        if (ded.has("pension"))    pushDed("pension", "국민연금", Math.round(grossPay * Number(insuranceRates.nationalPension)));
        if (ded.has("health"))     pushDed("health", "건강보험", Math.round(grossPay * Number(insuranceRates.healthInsurance)));
        if (ded.has("ltc"))        pushDed("ltc", "장기요양보험", Math.round(grossPay * Number(insuranceRates.longTermCare)));
        if (ded.has("employment")) pushDed("employment", "고용보험", Math.round(grossPay * Number(insuranceRates.employmentInsurance)));
      }
    }

    for (const ded of agencyDeductions) {
      const amount = ded.type === "PERCENTAGE" ? Math.round(grossPay * Number(ded.amount)) : Math.round(Number(ded.amount));
      pushDed(`custom_${ded.id}`, ded.name, amount);
    }

    const netPay = grossPay - totalDeduction;

    // 산재 — 전액 사업주 부담(워커 net 미반영). 표기용.
    const industrialRate = insuranceRates ? Number((insuranceRates as any).industrialAccident ?? 0) : 0;
    const employerIndustrial = elig.insurances.includes("industrial") ? Math.round(grossPay * industrialRate) : 0;
    const insurance = {
      incomeType, tier: elig.tier, insurances: elig.insurances, workerDeductible: elig.workerDeductible,
      employerIndustrial,
      employmentMonths: Number.isFinite(employmentMonths) ? +employmentMonths.toFixed(1) : null,
      monthlyHours, monthlyDays: workedDays, continuousMonths: +continuousMonths.toFixed(1),
    };

    itemInputs.push({
      workerId,
      grossPay: new Decimal(grossPay),
      totalDeduction: new Decimal(totalDeduction),
      netPay: new Decimal(netPay),
      workedDays,
      workedMinutes,
      breakdown: { ...breakdown, incomeType, deductionBreakdown, payLines, deductLines, basicInfo, totalHours, insurance },
    });
  }

  return { items: itemInputs, userCount: userIds.length };
}
