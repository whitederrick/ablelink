// lib/payroll/computeRun.ts
// 월별 급여 계산(읽기 전용) — 에이전시·연월로 PayrollItem 입력값 배열을 산출한다.
// DB에 쓰지 않는다(생성은 호출측 트랜잭션). **급여 계산의 단일 소스** —
// 수동 계산(app/api/admin/payroll/runs POST)과 매월 자동 크론(cron/daily)이 모두 이 함수를 사용.

import { prisma } from "@/lib/prisma";
import { isPayrollPending } from "@/lib/attendance/payrollGate";
import { overtimeMinutesForDay, workEndMinutesForDay } from "@/lib/attendance/overtime";
import { computeWeeklyHoliday } from "@/lib/payroll/weeklyHoliday";
import { getKrHolidays } from "@/lib/krHolidays";
import { computeIncomeTax, type TaxBracket } from "@/lib/payroll/incomeTax";
import { determineEligibility, determineIncomeType, isIllegalBusinessIncome, type IncomeType } from "@/lib/payroll/insuranceEligibility";
import { standardMonthlyIncome } from "@/lib/payroll/pensionBase";
import { traineeCountOnDate } from "@/lib/traineePlacement";
import { Decimal } from "@prisma/client/runtime/library";
import type { PayrollBreakdown } from "@/lib/payroll/breakdown";

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

// start에 n개월 더하기(달력 기준, 말일 클램프). UTC 기준.
function addMonthsClampUTC(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return t;
}

// 계약기간[start, end](양끝 포함)이 달력 기준 1개월 미만인가 → 일용근로자 판정.
// 1개월 이상 = (start + 1개월) <= (end + 1일). 월별 일수 차이(2월 28/29 등)를 정확히 반영.
function isUnderOneCalendarMonth(start: Date, end: Date): boolean {
  const startPlus1 = addMonthsClampUTC(start, 1).getTime();
  const endPlus1 = end.getTime() + DAY_MS;
  return startPlus1 > endPlus1;
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
  // P1-11: 월 경계 주(週)는 "주가 끝나는(일요일이 속한) 달"에 귀속·지급한다. 경계주 만근을 온전히
  //  판정하려면 그 주의 전월 부분 출근이 필요하므로, 전월 말 ~7일치 출근을 함께 로드해 주휴 판정에만 쓴다.
  //  (급여·근무일수 등 나머지 계산은 당월 confirmedAtt만 사용 — lookback은 주휴 산정 전용.)
  const lookbackDate = new Date(Date.UTC(y, m - 1, 1) - 7 * 86400000);
  const lookbackStartISO = `${lookbackDate.getUTCFullYear()}-${String(lookbackDate.getUTCMonth() + 1).padStart(2, "0")}-${String(lookbackDate.getUTCDate()).padStart(2, "0")}`;
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;

  const [insuranceRates, agencyRow, agencyDeductions, assignments, incomeTaxRow] = await Promise.all([
    prisma.insuranceRates.findFirst({ where: { year: { lte: y } }, orderBy: { year: "desc" } }),
    prisma.agency.findUnique({ where: { id: agencyId }, select: { lateThresholdMin: true } as any }),
    prisma.agencyDeduction.findMany({ where: { agencyId, isActive: true } }),
    prisma.siteAssignment.findMany({
      where: {
        agencyId,
        // ★status:"ACTIVE"만 쓰면 과거월 재계산 시 이미 종료(ENDED)된 배정이 빠져 그 워커 급여가 통째 누락됨.
        //   근무가 발생할 수 있는 상태(출근 가능 ASSIGNED/CONFIRMED/ACTIVE + 종료 후 ENDED)만 포함하고,
        //   미근무 상태(REQUESTED/ACCEPTED/DROPPED/REJECTED/EXPIRED)는 date-overlap과 무관하게 제외.
        status: { in: ["ACTIVE", "ENDED", "ASSIGNED", "CONFIRMED"] },
        startDate: { lte: new Date(periodEnd + "T23:59:59+09:00") },
        OR: [{ endDate: null }, { endDate: { gte: new Date(periodStart + "T00:00:00+09:00") } }],
      },
      select: { workerId: true, siteId: true, serviceStep: true, startDate: true },
    }),
    prisma.incomeTaxTable.findFirst({ where: { year: { lte: y } }, orderBy: { year: "desc" } }),
  ]);
  const taxBrackets: TaxBracket[] = Array.isArray(incomeTaxRow?.data) ? (incomeTaxRow!.data as any) : [];
  const taxChildCredit = (incomeTaxRow?.meta as any)?.childCredit;
  const lateThresholdMin = (agencyRow as any)?.lateThresholdMin ?? 30; // 보정대기 게이트 기준(위탁기관별)

  const userIds = [...new Set(assignments.map((a) => a.workerId))];
  if (userIds.length === 0) return { items: [], userCount: 0 };

  const itemInputs: PayrollItemInput[] = [];

  // ── 로딩부: 워커별 6쿼리(N+1) → 전체 6쿼리 배치 조회 + 인메모리 그룹핑 ──
  //   과거엔 Promise.all(userIds.map(...))로 워커마다 6쿼리를 동시 발사 → 대형 기관(수십~100명)에서
  //   커넥션 풀 포화(P2024)로 급여계산이 통째로 실패했다. 여기서 workerId 배치로 한 번에 읽고
  //   메모리에서 워커별로 나눈다. **계산 로직·결과는 불변**(아래 for 루프에 넘기는 배열 모양 동일).
  const idKey = (id: bigint) => id.toString();
  const allSiteIds = [...new Set(assignments.map((a) => a.siteId))];

  const [allPayContracts, allAttendances, allPlacements, allEmpLatest, allEmpFirst, allHolidays, allLookbackAtt] = await Promise.all([
    // 같은 기관 다시급: 유효한 계약 전부(기관 기본 siteId=null + 현장별 override). 금액만 현장별 적용.
    //  급여월과 '겹치는' 계약(effectiveFrom<=월말 AND (effectiveTo=null OR >=월초)). 최신(effectiveFrom desc) 우선.
    prisma.payContract.findMany({
      where: {
        agencyId, workerId: { in: userIds },
        effectiveFrom: { lte: new Date(periodEnd) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodStart) } }],
      },
      orderBy: { effectiveFrom: "desc" },
    }),
    prisma.dailyAttendance.findMany({
      // ★근본 chokepoint(placeholder 유령 근무일 차단): isFinalClosed:true여도 startTime 없는 행은
      //  '출근한 적 없는' placeholder(logs/save 생성)다. 6~8차 감사서 여러 finalize 경로(late-clockout·
      //  매니저확정·home자동마감·worker confirm·admin PATCH)가 이를 확정시켜 workedDays를 부풀렸다(과지급).
      //  write측 가드는 경로마다 새어 whack-a-mole → 여기서 단일 차단. 정상 근무일은 startTime이 항상 있음
      //  (clock-in·cron면제·bulk·confirm-month 전부). ※actualStartTime 아닌 startTime 기준 —
      //  면제/일괄 정상행(actualStartTime=null·startTime有)은 유지(2026-07-06 가드제거 사유 회피).
      where: { workerId: { in: userIds }, workDate: { gte: periodStart, lte: periodEnd }, isFinalClosed: true, startTime: { not: null }, assignment: { agencyId } },
      select: {
        workerId: true,
        workDate: true, startTime: true, endTime: true,
        actualStartTime: true, actualEndTime: true, payrollConfirmedAt: true,
        assignment: { select: { siteId: true, workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true, site: { select: { lateThresholdMin: true } } } },
        logs: { select: { extTime1on1: true, extTimeGroup: true } },
      },
    }),
    // 1:多 배율용 훈련생 배치 이력 — 관련 현장 전체를 한 번에 조회 후, 워커별 소속 현장으로 인메모리 필터.
    //  status 필터 없음(이탈은 endDate로 표현). 일자별 동시 재적 수로 1:1/1:多 판정(traineeCountOnDate).
    prisma.traineePlacement.findMany({
      where: {
        siteId: { in: allSiteIds },
        startDate: { lte: periodEndDate },
        OR: [{ endDate: null }, { endDate: { gte: periodStartDate } }],
      },
      select: { siteId: true, startDate: true, endDate: true },
    }),
    // 근로계약: 급여월과 겹치는 것 중 최신(contractStart desc) = 워커별 첫 행.
    prisma.employmentContract.findMany({
      where: { agencyId, workerId: { in: userIds }, contractStart: { lte: periodEndDate }, contractEnd: { gte: periodStartDate } },
      orderBy: { contractStart: "desc" },
      select: { workerId: true, workDaysPerWeek: true, weeklyHoliday: true, contractStart: true, contractEnd: true, workStartTime: true, workEndTime: true, breakStartTime: true, breakEndTime: true },
    }),
    // 최초 근로계약(contractStart asc, 기간필터 없음) = 계속근로 산정 기준. 워커별 첫 행.
    prisma.employmentContract.findMany({
      where: { agencyId, workerId: { in: userIds } },
      orderBy: { contractStart: "asc" },
      select: { workerId: true, contractStart: true },
    }),
    // 커스텀휴무(현장 지정 휴무일, countAsWorkday=false) — 주휴 개근 판정에서 소정근로일 제외.
    //  (P1-11 경계주 판정 위해 lookback 시작일부터 로드 — 전월 부분 주의 휴무도 반영.)
    prisma.siteHoliday.findMany({
      where: { assignment: { workerId: { in: userIds }, agencyId }, countAsWorkday: false, date: { gte: lookbackStartISO, lte: periodEnd } },
      select: { date: true, assignment: { select: { workerId: true } } },
    }),
    // P1-11: 전월 말 lookback 출근(주휴 경계주 만근 판정 전용). 당월 계산엔 미사용.
    prisma.dailyAttendance.findMany({
      // ★chokepoint 동일 적용: startTime 없는 placeholder는 경계주 만근 판정(주휴)에서도 유령일로 제외.
      where: { workerId: { in: userIds }, workDate: { gte: lookbackStartISO, lt: periodStart }, isFinalClosed: true, startTime: { not: null }, assignment: { agencyId } },
      select: {
        workerId: true,
        workDate: true, startTime: true, endTime: true,
        actualStartTime: true, actualEndTime: true, payrollConfirmedAt: true,
        assignment: { select: { siteId: true, workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true, site: { select: { lateThresholdMin: true } } } },
      },
    }),
  ]);

  // 워커별 그룹핑 — 쿼리의 정렬 순서를 보존하므로 기존 per-worker orderBy와 동일한 결과.
  const payByW = new Map<string, typeof allPayContracts>();
  for (const c of allPayContracts) { const k = idKey(c.workerId); (payByW.get(k) ?? (payByW.set(k, []), payByW.get(k)!)).push(c); }
  const attByW = new Map<string, typeof allAttendances>();
  for (const a of allAttendances) { const k = idKey(a.workerId); (attByW.get(k) ?? (attByW.set(k, []), attByW.get(k)!)).push(a); }
  const lookbackByW = new Map<string, typeof allLookbackAtt>();
  for (const a of allLookbackAtt) { const k = idKey(a.workerId); (lookbackByW.get(k) ?? (lookbackByW.set(k, []), lookbackByW.get(k)!)).push(a); }
  const holByW = new Map<string, { date: string }[]>();
  for (const h of allHolidays) { const k = idKey(h.assignment.workerId); (holByW.get(k) ?? (holByW.set(k, []), holByW.get(k)!)).push({ date: h.date }); }
  // desc/asc 정렬 → 워커별 '첫 행'이 각각 최신/최초(기존 findFirst와 동치).
  const empLatestByW = new Map<string, (typeof allEmpLatest)[number]>();
  for (const e of allEmpLatest) { if (!empLatestByW.has(idKey(e.workerId))) empLatestByW.set(idKey(e.workerId), e); }
  const empFirstByW = new Map<string, (typeof allEmpFirst)[number]>();
  for (const e of allEmpFirst) { if (!empFirstByW.has(idKey(e.workerId))) empFirstByW.set(idKey(e.workerId), e); }

  const userDataList = userIds.map((workerId) => {
    const siteSet = new Set(assignments.filter((a) => a.workerId === workerId).map((a) => idKey(a.siteId)));
    return {
      workerId,
      payContracts: payByW.get(idKey(workerId)) ?? [],
      attendances: attByW.get(idKey(workerId)) ?? [],
      placements: allPlacements.filter((p) => siteSet.has(idKey(p.siteId))),
      empContract: empLatestByW.get(idKey(workerId)) ?? null,
      firstContract: empFirstByW.get(idKey(workerId)) ?? null,
      customHolidays: holByW.get(idKey(workerId)) ?? [],
      lookbackAtt: lookbackByW.get(idKey(workerId)) ?? [],
    };
  });

  for (const { workerId, payContracts, attendances, placements, empContract, firstContract, customHolidays, lookbackAtt } of userDataList) {
    // 기관 기본 계약(siteId=null) = 급여유형·소득유형·4대보험·기본금액의 기준.
    //  (findMany는 effectiveFrom desc 정렬 → 각 그룹의 최신이 앞. 최신 기본계약 우선.)
    //  ★기본계약 없이 현장 override만 있으면(고아) '급여 계약 없음'으로 처리한다 —
    //   과거엔 payContracts[0](고아 override)로 폴백해 그 현장 금액이 전 현장을 지배하는 버그가 있었다.
    //   (기본계약 삭제는 override가 남아있으면 API에서 거부. 시딩도 siteId:null 기준으로 존재확인.)
    //  ★M9 정책(사용자 확정 2026-07-06): **월중 단가변경은 지원하지 않는다**(계약변경은 월 경계 기준).
    //   한 달에 겹치는 기본계약은 하나라는 전제 → 최신 계약을 그 달 전체에 적용한다(일자별 분할 안 함).
    //   월 중간 '입사'(그 달 유일 계약이 mid-month 시작)는 정상 지급됨. 만약 월중 단가변경이 발생하면
    //   그 달 전체가 최신 단가로 소급 계산되며, 정밀 일할이 필요한 소급 조정은 **별도 수동 프로세스**로 처리한다.
    //  ★현장별 다시급(PayContract.siteId override) 제거(2026-07-06, 사용자 확정: 실무 미사용).
    //   워커당 급여 기준은 하나다. base(siteId=null)를 쓰되, 없으면 그 달 겹치는 계약 중 최신으로 폴백(급여0 방지).
    const contract = payContracts.find((c) => c.siteId == null) ?? payContracts[0] ?? null;
    // 그 날 그 현장에 "동시에 재적 중인" 훈련생 수 → 1:1(일반) vs 1:多 배율 판정(일자별).
    //  · placement.startDate ≤ 그날 && (endDate=null || endDate ≥ 그날) 인 배치 수 = 그날 동시 재적.
    //  판정 규칙은 출근부(attendanceSheetPayload)와 공유 — lib/traineePlacement.traineeCountOnDate 단일 소스.
    const traineeCountOn = (siteId: bigint | null | undefined, workDate: string): number =>
      siteId == null ? 0 : traineeCountOnDate(placements, workDate, siteId);
    // 급여 게이트: 심한 지각 미컨펌(보정대기) 날은 급여 산정에서 제외(출근부 PDF와 동일 기준).
    // 지각 기준 = 현장값(site.lateThresholdMin) ?? 위탁기관 기본값 ?? 30.
    // ★M8/X2 되돌림(2026-07-06): 여기서 '시각 없는 확정행 제외' 가드를 뒀더니, 시각 대기 중인 정당한 근무일까지
    //  빠져 MONTHLY 일할·DAILY 일수가 과소집계됐다. batch-save가 시각 없는 행을 isFinalClosed:false로 만들도록
    //  근본 수정했으므로(급여 쿼리는 isFinalClosed:true만) 여기서 별도 시각가드는 불필요·유해 → 제거.
    const confirmedAtt = attendances.filter((a) =>
      !isPayrollPending({
      actualStartTime: a.actualStartTime ?? null,
      actualEndTime: a.actualEndTime ?? null,
      payrollConfirmedAt: a.payrollConfirmedAt ?? null,
      workType: a.assignment?.workType ?? null,
      commuteGuidanceIncluded: a.assignment?.commuteGuidanceIncluded ?? null,
      customWorkStart: a.assignment?.customWorkStart ?? null,
      customWorkEnd: a.assignment?.customWorkEnd ?? null,
      exempt: a.assignment?.attendanceButtonExempt ?? false,
    }, (a.assignment as any)?.site?.lateThresholdMin ?? lateThresholdMin));
    const pendingDays = attendances.length - confirmedAtt.length;

    // DAILY/MONTHLY(일급·월급)는 시간분해가 없어 일자별 배분 불가 → 근무일 중 "동시 재적 최대치"로 1:多 판정
    //  (기간 전체 총원이 아니라 실제 근무한 날들의 동시 재적 peak — 비동시 재적을 1:多로 오판하지 않음).
    const maxSiteCount = confirmedAtt.reduce((mx, a) => Math.max(mx, traineeCountOn(a.assignment?.siteId, a.workDate)), 0);

    // P1-14: 근무일수 = 캘린더 '일' 기준(같은 날 2배정=오전 A현장+오후 B현장이어도 1일).
    //  명세서 (N)일·DAILY 일급·MONTHLY 일할·보험 8일판정이 같은 날을 2로 부풀리지 않도록 workDate로 dedup.
    //  (근무시간·지급시간·가산수당은 실제 근무 행별로 합산하므로 아래 workedMinutes 등은 그대로 전 행 순회.)
    const workedDays = new Set(confirmedAtt.map((a) => a.workDate)).size;
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
    // 소정근로 요일 집합 + 그 달 소정근로일수(공휴일·커스텀휴무 제외). 월급 일할계산·주휴 개근 판정 공용.
    //  · 소정근로 요일 = 월~ 순으로 주휴일(weeklyHoliday) 제외하고 workDaysPerWeek개(5일=월~금, 6일=월~토).
    const DOW_LABEL: Record<string, number> = { "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6 };
    const wpw = empContract?.workDaysPerWeek ?? 5;
    const restDow = empContract?.weeklyHoliday ? (DOW_LABEL[empContract.weeklyHoliday] ?? 0) : 0;
    const workingWeekdays = new Set<number>();
    for (const d of [1, 2, 3, 4, 5, 6, 0]) { if (d === restDow) continue; workingWeekdays.add(d); if (workingWeekdays.size >= wpw) break; }
    // 공휴일(법정)+커스텀휴무 → 소정근로일에서 제외. 둘 다 KST "YYYY-MM-DD".
    const monthHolidaySet = new Set<string>([...Object.keys(getKrHolidays(y, m)), ...customHolidays.map((h) => h.date)]);
    const daysInMonth = new Date(y, m, 0).getDate();
    let scheduledWorkdaysInMonth = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      if (!workingWeekdays.has(dow)) continue;
      if (monthHolidaySet.has(`${yearMonth}-${String(d).padStart(2, "0")}`)) continue;
      scheduledWorkdaysInMonth++;
    }
    // 연장근로 = 일반 배정은 퇴근시각(actualEndTime) 자동 산정(전일은 저녁식사 1h 무급 제외),
    //            출퇴근버튼 면제 배정은 일지 수동입력(extTime). 분 단위.
    const overtimeMinutes = confirmedAtt.reduce(
      (s, a) => s + overtimeMinutesForDay({
        workType: a.assignment?.workType,
        exempt: a.assignment?.attendanceButtonExempt,
        actualEndTime: a.actualEndTime ?? null,
        commuteGuidanceIncluded: a.assignment?.commuteGuidanceIncluded,
        customWorkStart: a.assignment?.customWorkStart,
        customWorkEnd: a.assignment?.customWorkEnd,
        manualExtHours: a.logs.reduce((t, l) => t + Number(l.extTime1on1) + Number(l.extTimeGroup), 0),
      }), 0);
    const overtimeHours = +(overtimeMinutes / 60).toFixed(2);

    let grossPay = 0;
    const calcMethods: Record<string, string> = {};
    let breakdown: PayrollBreakdown = { note: "급여 계약 없음", workedDays, workedMinutes, pendingDays };

    if (contract) {
      // 급여 기준 계약의 시급/일급/월급(baseRate)과 2인 이상 지원 시급(rate2).
      const baseRate = Number(contract.baseAmount);
      const rate2 = contract.hourlyRate2Plus != null ? Number(contract.hourlyRate2Plus) : null;

      let ordinaryWage = 0;
      if (contract.payType === "HOURLY") {
        // 지급시간을 1:1(일반)/1:多(그날 2인+ 재적) 로 나눠 합산. 단일 계약 시급(baseRate)·2인시급(rate2) 사용.
        let oneToOneHours = 0, oneToManyHours = 0;
        for (const a of confirmedAtt) {
          const span = minutesBetween(a.startTime, a.endTime);
          const ph = Math.max(0, span - unpaidBreakMin(a.assignment?.workType, span)) / 60;
          const isMulti = rate2 != null && traineeCountOn(a.assignment?.siteId, a.workDate) >= 2;
          if (isMulti) oneToManyHours += ph; else oneToOneHours += ph;
        }
        const base = oneToOneHours * baseRate + oneToManyHours * (rate2 ?? baseRate);
        grossPay = Math.round(base);
        // 통상시급(연장·야간·휴일·주휴 가산 기준) = 지급시간 가중평균 시급. 단일 시급이면 그 시급과 동일.
        ordinaryWage = paidHours > 0 ? Math.round(base / paidHours) : baseRate;
        const used2Plus = oneToManyHours > 0;
        calcMethods["기본급"] = used2Plus && oneToOneHours > 0
          ? `1:1 ${(+oneToOneHours.toFixed(2))}h × ${baseRate.toLocaleString()}원 + 1:多 ${(+oneToManyHours.toFixed(2))}h × ${(rate2 as number).toLocaleString()}원 (휴게 제외)`
          : `${paidHours}시간 × ${(used2Plus ? (rate2 as number) : baseRate).toLocaleString()}원 (휴게 제외)`;
        breakdown = { payType: "HOURLY", hourlyRate: baseRate, hourlyRate2Plus: rate2, oneToOneHours: +oneToOneHours.toFixed(2), oneToManyHours: +oneToManyHours.toFixed(2), used2PlusRate: used2Plus, workedMinutes, workedHours, paidMinutes, paidHours, workedDays, pendingDays };
      } else if (contract.payType === "DAILY") {
        // 각 '근무일'(캘린더 일)에 일급 1건 — P1-14: 같은 날 2배정(오전+오후)도 1일급.
        //  그날 어느 배정이든 1:多(2인+ 재적)면 그날 일급은 rate2, 아니면 baseRate.
        const dayMulti = new Map<string, boolean>();
        for (const a of confirmedAtt) {
          const isMulti = rate2 != null && traineeCountOn(a.assignment?.siteId, a.workDate) >= 2;
          dayMulti.set(a.workDate, (dayMulti.get(a.workDate) ?? false) || isMulti);
        }
        let base = 0;
        for (const isMulti of dayMulti.values()) base += isMulti ? (rate2 as number) : baseRate;
        grossPay = Math.round(base);
        // 통상시급 = 총 일급 ÷ 총 지급시간(무급휴게 제외). 연장·주휴 가산 기준.
        ordinaryWage = paidHours > 0 ? Math.round(grossPay / paidHours) : 0;
        const dispRate = (maxSiteCount >= 2 && rate2 != null) ? rate2 : baseRate;
        calcMethods["기본급"] = `${workedDays}일 × ${dispRate.toLocaleString()}원`;
        breakdown = { payType: "DAILY", dailyRate: dispRate, workedDays, workedMinutes, pendingDays };
      } else {
        const rate = (maxSiteCount >= 2 && rate2 != null) ? rate2 : baseRate;
        // 월급 일할계산: 중도입사·중도퇴사·결근으로 실근로일(workedDays)이 그 달 소정근로일보다 적으면 비례 지급.
        //  · 완전월·개근이면 workedDays == 소정근로일 → 월정액 전액. (유급휴일 몫은 월급에 포함돼 비례로 함께 반영)
        //  · 통상시급(연장·야간·휴일 가산 기준)은 비례하지 않는다(209h 기준 그대로).
        const schedDays = scheduledWorkdaysInMonth;
        const prorate = schedDays > 0 && workedDays < schedDays;
        grossPay = prorate ? Math.round((rate * workedDays) / schedDays) : rate;
        ordinaryWage = Math.round(rate / 209); // 월 소정근로시간 209h 기준
        calcMethods["기본급"] = prorate
          ? `월 ${rate.toLocaleString()}원 × ${workedDays}/${schedDays}일 (일할)`
          : `월 ${rate.toLocaleString()}원`;
        breakdown = { payType: "MONTHLY", monthlyRate: rate, scheduledWorkdays: schedDays, workedDays, prorated: prorate, workedMinutes, pendingDays };
      }

      if (overtimeHours > 0 && ordinaryWage > 0) {
        const overtimePay = Math.round(overtimeHours * ordinaryWage * 1.5);
        grossPay += overtimePay;
        breakdown.overtimeHours = overtimeHours;
        breakdown.overtimePay = overtimePay;
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
        let nightMin = 0;
        // H: 휴일근로 8h 경계는 '일별 합계'에 적용해야 한다. 행 단위로 나누면 같은 날 2배정(AM+PM)
        //  합계가 8h를 넘어도 각 행이 8h 미만이면 초과분이 0.5배로 과소지급된다. → 날짜별로 모은 뒤 1회 판정.
        const holidayMinByDate = new Map<string, number>();
        for (const a of confirmedAtt) {
          if (!a.startTime || !a.endTime) continue;
          const s = kstMin(a.startTime), e = kstMin(a.endTime);
          // 야간(22시+)은 연장 포함 실효 퇴근시각까지 검출. 일반 배정=실제 퇴근시각, 면제 배정=고정 종료+수동 연장.
          // (전일 저녁식사 18:00~19:00 갭은 야간창 22:00 이전이라 영향 없음)
          const eNight = workEndMinutesForDay({
            workType: a.assignment?.workType,
            exempt: a.assignment?.attendanceButtonExempt,
            scheduledEndMin: e,
            actualEndTime: a.actualEndTime,
            manualExtHours: a.logs.reduce((t, l) => t + Number(l.extTime1on1) + Number(l.extTimeGroup), 0),
          });
          if (eNight > s) nightMin += ovl(s, eNight, 0, 360) + ovl(s, eNight, 1320, 1440); // 자정 안 넘는 경우만
          const [yy, mm2, dd] = a.workDate.split("-").map(Number);
          const dow = new Date(Date.UTC(yy, mm2 - 1, dd)).getUTCDay();
          // 휴일근로(공휴일·주휴일) 실근로시간(무급휴게 제외). 커스텀휴무는 여기 미포함=일반급여(가산 없음).
          //  · 1일 8h 이내는 0.5배 가산, 8h 초과분은 1.0배 가산(총 2.0배). 일별로 8h 경계 판정.
          if (holidaySet.has(a.workDate) || dow === whDow) {
            const span = Math.max(0, e - s);
            const workedMin = Math.max(0, span - unpaidBreakMin(a.assignment?.workType, span));
            holidayMinByDate.set(a.workDate, (holidayMinByDate.get(a.workDate) ?? 0) + workedMin);
          }
        }
        // 날짜별 합계에 8h 경계 적용(8h이내 0.5배 + 초과 1.0배).
        let holidayLe8Min = 0, holidayGt8Min = 0;
        for (const dayMin of holidayMinByDate.values()) {
          holidayLe8Min += Math.min(dayMin, 480);
          holidayGt8Min += Math.max(0, dayMin - 480);
        }
        if (nightMin > 0) {
          const nightHours = +(nightMin / 60).toFixed(2);
          const pay = Math.round(nightHours * ordinaryWage * 0.5);
          grossPay += pay;
          breakdown.nightHours = nightHours; breakdown.nightPay = pay;
          calcMethods["야간근로수당"] = `${nightHours}시간 × ${ordinaryWage.toLocaleString()}원 × 0.5`;
        }
        if (holidayLe8Min > 0 || holidayGt8Min > 0) {
          const h8 = +(holidayLe8Min / 60).toFixed(2);
          const hOver = +(holidayGt8Min / 60).toFixed(2);
          const pay = Math.round(h8 * ordinaryWage * 0.5 + hOver * ordinaryWage * 1.0);
          grossPay += pay;
          breakdown.holidayHours = +(h8 + hOver).toFixed(2);
          breakdown.holidayPay = pay;
          if (hOver > 0) { breakdown.holidayHours8 = h8; breakdown.holidayHoursOver8 = hOver; }
          calcMethods["휴일근로수당"] = hOver > 0
            ? `8h이내 ${h8}h × 0.5 + 초과 ${hOver}h × 1.0 (× ${ordinaryWage.toLocaleString()}원)`
            : `${h8}시간 × ${ordinaryWage.toLocaleString()}원 × 0.5`;
        }
      }

      // 주휴수당: 근로소득(EMPLOYMENT) 단시간 — 2조건 자동 산식. PayContract.weeklyHolidayPay 고정 오버라이드.
      //  ※ MONTHLY(월급)는 월정액 209h에 주휴가 이미 포함 → 별도 가산 안 함(이중지급 방지).
      //  ★P1-15: 게이트를 계약 원본값(contract.incomeType) 대신 공제·보험과 동일한 '유효 소득유형'으로 판정한다.
      //   근로계약이 있으면 급여기준이 BUSINESS로 오설정돼도 실제로는 근로소득(EMPLOYMENT)으로 계산되는데
      //   (elig.incomeType), 주휴 게이트만 원본 BUSINESS를 봐서 주휴가 누락되던 불일치를 제거. 아래 elig와
      //   동일 입력(determineIncomeType)이라 결과가 항상 일치한다. 정상 케이스는 결과 불변.
      const gateIncomeType = determineIncomeType({
        hasEmploymentContract: !!empContract,
        hasAttendance: workedDays > 0,
        freelancerOverride: contract?.incomeType === "BUSINESS" && !empContract,
      });
      if (gateIncomeType === "EMPLOYMENT" && contract.payType !== "MONTHLY" && ordinaryWage > 0) {
        // 소정근로시간 = 실질 약정 근로시간(출퇴근·휴게지도 포함, 무급휴게만 제외) = 지급시간과 동일.
        //  오전/오후 5.5h · 전일 8h. (주휴 = (1주 소정÷40)×8×시급)
        // P1-11: 당월 확정 출근 + 전월 lookback 확정 출근을 합쳐 경계주 만근을 온전히 판정한다
        //  (지급은 아래 payMonth로 "주가 끝나는 달==이 달"인 주만 집계 → 경계주는 끝나는 달에 1회 지급).
        const lookbackConfirmed = lookbackAtt.filter((a) =>
          !isPayrollPending({
            actualStartTime: a.actualStartTime ?? null,
            actualEndTime: a.actualEndTime ?? null,
            payrollConfirmedAt: a.payrollConfirmedAt ?? null,
            workType: a.assignment?.workType ?? null,
            commuteGuidanceIncluded: a.assignment?.commuteGuidanceIncluded ?? null,
            customWorkStart: a.assignment?.customWorkStart ?? null,
            customWorkEnd: a.assignment?.customWorkEnd ?? null,
            exempt: a.assignment?.attendanceButtonExempt ?? false,
          }, a.assignment?.site?.lateThresholdMin ?? lateThresholdMin));
        const days = [...confirmedAtt, ...lookbackConfirmed].map((a) => {
          const span = minutesBetween(a.startTime, a.endTime);
          const fallback = Math.max(0, span - unpaidBreakMin(a.assignment?.workType, span));
          return { dateISO: a.workDate, scheduledMinutes: contractDailySojeMin ?? fallback };
        });
        // 경계주 소정근로일 판정용 공휴일 = 당월+커스텀(monthHolidaySet, lookback 커스텀 포함) + 전월 법정공휴일.
        const whHolidaySet = new Set<string>([...monthHolidaySet, ...Object.keys(getKrHolidays(prevY, prevM))]);
        const wh = computeWeeklyHoliday({
          days, workDaysPerWeek: wpw, ordinaryWage,
          flatWeeklyHolidayPay: contract.weeklyHolidayPay ? Number(contract.weeklyHolidayPay) : null,
          workingWeekdays, holidaySet: whHolidaySet,
          // 이 달에 끝나는 모든 주를 seed 하되(결근주도 명시), payMonth로 "주가 끝나는 달==이 달"인 주만 집계·지급.
          periodStart: `${yearMonth}-01`,
          periodEnd: `${yearMonth}-${String(daysInMonth).padStart(2, "0")}`,
          payMonth: yearMonth,
        });
        if (wh.totalHolidayPay > 0) {
          grossPay += wh.totalHolidayPay;
          breakdown.weeklyHolidayPay = wh.totalHolidayPay;
          breakdown.weeklyHolidayDetail = { eligibleWeeks: wh.eligibleWeeks, avgWeeklyHours: +(wh.avgWeeklyMinutes / 60).toFixed(1), meets15h: wh.meets15h };
          calcMethods["주휴수당"] = wh.calcMethod;
        }
      }

      breakdown.ordinaryWage = ordinaryWage;
      breakdown.calcMethods = calcMethods;
    }

    // ── 지급내역 라인아이템(시드) ──
    const bd = breakdown;
    const owage = Number(bd.ordinaryWage ?? 0);
    const whPay = Number(bd.weeklyHolidayPay ?? 0);
    const whHours = owage > 0 ? +(whPay / owage).toFixed(1) : 0;
    const basePay = Math.round(grossPay - Number(bd.overtimePay ?? 0) - Number(bd.nightPay ?? 0) - Number(bd.holidayPay ?? 0) - whPay);
    const payLines: { key: string; name: string; hours: number; amount: number; method?: string }[] = [];
    if (bd.payType === "HOURLY") {
      const rate1 = Number(contract?.baseAmount ?? bd.hourlyRate ?? 0);
      const rate2 = contract?.hourlyRate2Plus != null ? Number(contract.hourlyRate2Plus) : Math.round(rate1 * 1.2);
      // 1:1(일반)·1:多(2인이상) 지원시간 × 각 시급. 단일 계약이라 합계 = grossPay 기본급과 일치.
      const h1 = Number(bd.oneToOneHours ?? 0);
      const h2 = Number(bd.oneToManyHours ?? 0);
      payLines.push({ key: "support1", name: "1인지원", hours: h1, amount: Math.round(h1 * rate1), method: rate1 ? `지원시간 × ${rate1.toLocaleString()}원` : "" });
      payLines.push({ key: "support2", name: "2인이상지원", hours: h2, amount: Math.round(h2 * rate2), method: rate1 ? `지원시간 × ${rate2.toLocaleString()}원` : "" });
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
    // 일용 판정은 달력 기준(월별 일수 차이 반영). 계약 없으면 일용 아님.
    const employmentUnderOneMonth = (empContract?.contractStart && empContract?.contractEnd)
      ? isUnderOneCalendarMonth(empContract.contractStart, empContract.contractEnd)
      : false;
    const firstStart = firstContract?.contractStart ?? empContract?.contractStart ?? periodStartDate;
    const continuousMonths = spanDays(firstStart, periodEndDate) / 30;
    const elig = determineEligibility(
      {
        hasEmploymentContract: !!empContract,
        hasAttendance: workedDays > 0,
        freelancerOverride: contract?.incomeType === "BUSINESS" && !empContract,
      },
      { employmentMonths, monthlyHours, monthlyDays: workedDays, continuousMonths, employmentUnderOneMonth },
    );

    // ── 공제 계산 ──
    let totalDeduction = 0;
    const deductionBreakdown: Record<string, number> = {};
    const deductLines: { key: string; name: string; amount: number }[] = [];
    const incomeType = elig.incomeType;
    // P2-5: 근로계약이 있는데 급여 기준이 사업소득(BUSINESS)으로 설정된 위법 소지 — 경고만(계산은 근로소득으로 자동 처리됨).
    if (contract?.incomeType && isIllegalBusinessIncome(!!empContract, contract.incomeType as IncomeType)) {
      breakdown.incomeWarn = "근로계약 존재 — 사업소득(3.3%) 설정은 위법 소지(근로소득으로 자동 계산됨)";
    }
    // 국민연금 가입 검토 대상(계약 1개월 미만이나 월 8일↑/60h↑) — 자동 공제하지 않고 경고만. 노무사·공단 확인 필요.
    if (elig.needsPensionReview) {
      breakdown.insuranceReview =
        "국민연금 가입 검토 필요 — 계약 1개월 미만이나 해당 월 근로일수 8일 이상 또는 60시간 이상. 국민연금공단 안내상 사업장가입 대상이 될 수 있어 공제·신고 전 노무사 또는 공단 확인 필요(현재 자동 공제 안 함).";
    }
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
        if (ded.has("pension")) {
          // 국민연금 = 기준소득월액 × 요율. 기준소득월액 = 월 보수 1,000원 절사 + [하한,상한] clamp.
          //  하한/상한 미설정(null) 연도는 종전 근사(지급액×요율) 유지 — 하위호환.
          const pBase = standardMonthlyIncome(
            grossPay,
            insuranceRates.pensionBaseMin != null ? Number(insuranceRates.pensionBaseMin) : null,
            insuranceRates.pensionBaseMax != null ? Number(insuranceRates.pensionBaseMax) : null,
          );
          const pensionBase = pBase ?? grossPay;
          pushDed("pension", "국민연금", Math.round(pensionBase * Number(insuranceRates.nationalPension)));
          breakdown.pensionBase = pensionBase;         // 명세 투명성(적용된 기준소득월액)
          breakdown.pensionBaseClamped = pBase != null; // 등급표 적용 여부(하한/상한)
        }
        if (ded.has("health"))     pushDed("health", "건강보험", Math.round(grossPay * Number(insuranceRates.healthInsurance)));
        if (ded.has("ltc"))        pushDed("ltc", "장기요양보험", Math.round(grossPay * Number(insuranceRates.longTermCare)));
        if (ded.has("employment")) pushDed("employment", "고용보험", Math.round(grossPay * Number(insuranceRates.employmentInsurance)));
      }
    }

    // 지급액이 0이면(급여계약 없음·무근무 등) 커스텀 공제(고정액 포함)를 부과하지 않는다 → 실지급 음수 방지.
    if (grossPay > 0) {
      for (const ded of agencyDeductions) {
        const amount = ded.type === "PERCENTAGE" ? Math.round(grossPay * Number(ded.amount)) : Math.round(Number(ded.amount));
        pushDed(`custom_${ded.id}`, ded.name, amount);
      }
    }

    const netPay = grossPay - totalDeduction;

    // 산재 — 전액 사업주 부담(워커 net 미반영). 표기용.
    const industrialRate = insuranceRates ? Number((insuranceRates as any).industrialAccident ?? 0) : 0;
    const employerIndustrial = elig.insurances.includes("industrial") ? Math.round(grossPay * industrialRate) : 0;
    const insurance = {
      incomeType, tier: elig.tier, insurances: elig.insurances, workerDeductible: elig.workerDeductible,
      needsPensionReview: !!elig.needsPensionReview,
      employerIndustrial,
      // 실제 적용된 요율/세액표 연도(year ≤ 급여연도 중 최신). null = 미설정 → 해당 공제 0원.
      rateYear: insuranceRates?.year ?? null,
      taxYear: incomeTaxRow?.year ?? null,
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
