// scripts/payroll-dryrun.mts
// 급여 계산 "읽기 전용" 드라이런 — 실제 데이터로 runs/route.ts와 동일 로직을 적용해 결과만 출력.
// DB에 아무것도 쓰지 않는다. (보정대기 게이트는 단순화: isFinalClosed 전부 인정)
// 실행: npx tsx scripts/payroll-dryrun.mts [YYYY-MM]
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import { PrismaClient } from "@prisma/client";
import { determineEligibility } from "../lib/payroll/insuranceEligibility";
import { computeWeeklyHoliday, scheduledMinutesForWorkType } from "../lib/payroll/weeklyHoliday";
import { computeIncomeTax, type TaxBracket } from "../lib/payroll/incomeTax";

const prisma = new PrismaClient();
const won = (n: number) => Math.round(n).toLocaleString("ko-KR") + "원";
const DAY_MS = 86400000;
const spanDays = (a: Date, b: Date) => Math.max(0, Math.floor((b.getTime() - a.getTime()) / DAY_MS) + 1);
const minutesBetween = (s: Date | null, e: Date | null) => (!s || !e ? 0 : Math.max(0, Math.round((e.getTime() - s.getTime()) / 60000)));
const TIER_LABEL: Record<string, string> = { DAILY_WORKER: "일용(1개월미만)", ULTRA_SHORT: "초단시간", REGULAR: "일반/상용", NONE: "사업소득" };

async function main() {
  const demo = process.argv.includes("--demo"); // 급여기준·보험요율 없으면 예시값으로 계산
  // 대상 월: 인자 또는 isFinalClosed 출근부가 있는 가장 최근 월
  let ym = process.argv.slice(2).find(a => /^\d{4}-\d{2}$/.test(a)) || "";
  if (!ym) {
    const latest = await prisma.dailyAttendance.findFirst({ where: { isFinalClosed: true }, orderBy: { workDate: "desc" }, select: { workDate: true } });
    if (!latest) { console.log("⚠️ isFinalClosed 출근부가 없습니다. 계산할 데이터가 없습니다."); return; }
    ym = String(latest.workDate).slice(0, 7);
  }
  // 대상 에이전시: 그 달 출근부가 있는 첫 에이전시
  const sample = await prisma.dailyAttendance.findFirst({
    where: { isFinalClosed: true, workDate: { gte: `${ym}-01`, lte: `${ym}-31` } },
    select: { assignment: { select: { agencyId: true } } },
  });
  const agencyId = sample?.assignment?.agencyId;
  if (!agencyId) { console.log(`⚠️ ${ym} 에 확정 출근부가 없습니다.`); return; }
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } });

  const [y, m] = ym.split("-").map(Number);
  const periodStart = `${ym}-01`;
  const periodEnd = `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  const periodStartDate = new Date(periodStart + "T00:00:00+09:00");
  const periodEndDate = new Date(periodEnd + "T23:59:59+09:00");

  const [insuranceRates, assignments, incomeTaxRow] = await Promise.all([
    prisma.insuranceRates.findFirst({ where: { year: { lte: y } }, orderBy: { year: "desc" }, select: { year: true, nationalPension: true, healthInsurance: true, longTermCare: true, employmentInsurance: true } }),
    prisma.siteAssignment.findMany({
      where: { agencyId, status: "ACTIVE", startDate: { lte: periodEndDate }, OR: [{ endDate: null }, { endDate: { gte: periodStartDate } }] },
      select: { workerId: true, siteId: true, startDate: true },
    }),
    prisma.incomeTaxTable.findFirst({ where: { year: { lte: y } }, orderBy: { year: "desc" } }),
  ]);
  const taxBrackets: TaxBracket[] = Array.isArray(incomeTaxRow?.data) ? (incomeTaxRow!.data as any) : [];
  const taxChildCredit = (incomeTaxRow?.meta as any)?.childCredit;
  const userIds = [...new Set(assignments.map(a => a.workerId))];

  // 예시 요율(가입 4대보험 근로자 부담, % of gross 근사) — DB에 보험요율이 없을 때 demo용
  const SAMPLE_RATES = { nationalPension: 0.045, healthInsurance: 0.03545, longTermCare: 0.00459, employmentInsurance: 0.009 };
  const rates: any = insuranceRates ?? (demo ? SAMPLE_RATES : null);

  console.log(`\n📊 급여 계산 드라이런 — ${agency?.name ?? agencyId} · ${ym}  (대상 ${userIds.length}명, 읽기전용·DB 미반영${demo ? " · DEMO 예시값" : ""})`);
  console.log(`   보험요율 ${insuranceRates ? `${insuranceRates.year}년` : rates ? "예시(2026)" : "미설정"} · 간이세액표 ${taxBrackets.length}구간${demo && taxBrackets.length === 0 ? "(미등록→소득세 0)" : ""}\n`);
  if (userIds.length === 0) { console.log("대상 직무지도원이 없습니다."); return; }

  let tg = 0, td = 0, tn = 0;
  for (const workerId of userIds) {
    const userSiteIds = assignments.filter(a => a.workerId === workerId).map(a => a.siteId);
    const [worker, contract, atts, traineeCount, empContract, firstContract] = await Promise.all([
      prisma.worker.findUnique({ where: { id: workerId }, select: { workerName: true } }),
      prisma.payContract.findFirst({ where: { agencyId, workerId, effectiveFrom: { lte: new Date(periodStart) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodEnd) } }] }, orderBy: { effectiveFrom: "desc" } }),
      prisma.dailyAttendance.findMany({
        where: { workerId, workDate: { gte: periodStart, lte: periodEnd }, isFinalClosed: true, assignment: { agencyId } },
        select: { workDate: true, startTime: true, endTime: true, assignment: { select: { workType: true, customWorkStart: true, customWorkEnd: true } }, logs: { select: { extTime1on1: true, extTimeGroup: true } } },
      }),
      prisma.traineePlacement.count({ where: { siteId: { in: userSiteIds }, status: "ACTIVE", startDate: { lte: periodEndDate }, OR: [{ endDate: null }, { endDate: { gte: periodStartDate } }] } }),
      prisma.employmentContract.findFirst({ where: { agencyId, workerId, contractStart: { lte: periodEndDate }, contractEnd: { gte: periodStartDate } }, orderBy: { contractStart: "desc" }, select: { workDaysPerWeek: true, contractStart: true, contractEnd: true } }),
      prisma.employmentContract.findFirst({ where: { agencyId, workerId }, orderBy: { contractStart: "asc" }, select: { contractStart: true } }),
    ]);
    const name = worker?.workerName ?? String(workerId);
    const c: any = contract ?? (demo ? { payType: "HOURLY", baseAmount: 10320, hourlyRate2Plus: 12384, weeklyHolidayPay: null, incomeType: "EMPLOYMENT" } : null);
    if (!c) { console.log(`- ${name}: 급여 기준 없음 → 건너뜀`); continue; }

    const workedDays = atts.length;
    const workedMinutes = atts.reduce((s, a) => s + minutesBetween(a.startTime, a.endTime), 0);
    const workedHours = +(workedMinutes / 60).toFixed(2);
    // HOURLY 지급시간 = span − 무급휴게(전일 60·CUSTOM 4h↑ 30·오전/오후 0). computeRun과 동일 규칙.
    const paidMinutes = atts.reduce((s, a) => { const span = minutesBetween(a.startTime, a.endTime); const wt = a.assignment?.workType; const brk = wt === "FULL_DAY" ? 60 : (wt === "CUSTOM" && span >= 240 ? 30 : 0); return s + Math.max(0, span - brk); }, 0);
    const paidHours = +(paidMinutes / 60).toFixed(2);
    const overtimeHours = atts.reduce((s, a) => s + a.logs.reduce((t, l) => t + Number(l.extTime1on1) + Number(l.extTimeGroup), 0), 0);

    // 기본급 + 통상시급
    const use2 = traineeCount >= 2 && c.hourlyRate2Plus != null;
    const rate = use2 ? Number(c.hourlyRate2Plus) : Number(c.baseAmount);
    let gross = 0, ordinary = 0;
    if (c.payType === "HOURLY") { gross = Math.round(paidHours * rate); ordinary = rate; }
    else if (c.payType === "DAILY") { gross = workedDays * rate; const ad = workedDays ? workedMinutes / workedDays / 60 : 0; ordinary = ad ? Math.round(rate / ad) : 0; }
    else { gross = rate; ordinary = Math.round(rate / 209); }
    if (overtimeHours > 0 && ordinary > 0) gross += Math.round(overtimeHours * ordinary * 1.5);

    // 주휴(근로소득 단시간) — PayContract.weeklyHolidayPay 고정 오버라이드 반영
    if (ordinary > 0) {
      const days = atts.map(a => ({ dateISO: a.workDate, scheduledMinutes: scheduledMinutesForWorkType(a.assignment?.workType ?? null, a.assignment?.customWorkStart ?? null, a.assignment?.customWorkEnd ?? null) }));
      const wh = computeWeeklyHoliday({ days, workDaysPerWeek: empContract?.workDaysPerWeek ?? 5, ordinaryWage: ordinary, flatWeeklyHolidayPay: c.weeklyHolidayPay ? Number(c.weeklyHolidayPay) : null });
      if (wh.totalHolidayPay > 0) gross += wh.totalHolidayPay;
    }

    // 소득유형·4대보험 자동 판정
    const monthlyScheduledMin = atts.reduce((s, a) => s + scheduledMinutesForWorkType(a.assignment?.workType ?? null, a.assignment?.customWorkStart ?? null, a.assignment?.customWorkEnd ?? null), 0);
    const employmentMonths = (empContract?.contractStart && empContract?.contractEnd) ? spanDays(empContract.contractStart, empContract.contractEnd) / 30 : Infinity;
    const firstStart = firstContract?.contractStart ?? empContract?.contractStart ?? periodStartDate;
    const elig = determineEligibility(
      { hasEmploymentContract: !!empContract, hasAttendance: workedDays > 0, freelancerOverride: c.incomeType === "BUSINESS" && !empContract },
      { employmentMonths, monthlyHours: monthlyScheduledMin / 60, monthlyDays: workedDays, continuousMonths: spanDays(firstStart, periodEndDate) / 30 },
    );

    // 공제
    const ded: string[] = [];
    let deduction = 0;
    const add = (label: string, amt: number) => { ded.push(`${label} ${won(amt)}`); deduction += amt; };
    if (elig.incomeType === "BUSINESS") {
      add("사업소득세(3.3%)", Math.round(gross * 0.033));
    } else {
      const tax = computeIncomeTax(taxBrackets, gross, 1, { childUnder20: 0, rate: 100, childCredit: taxChildCredit });
      add("소득세", tax.tax); add("주민세", tax.localTax);
      if (rates) {
        const s = new Set(elig.workerDeductible);
        if (s.has("pension")) add("국민연금", Math.round(gross * Number(rates.nationalPension)));
        if (s.has("health")) add("건강", Math.round(gross * Number(rates.healthInsurance)));
        if (s.has("ltc")) add("장기요양", Math.round(gross * Number(rates.longTermCare)));
        if (s.has("employment")) add("고용", Math.round(gross * Number(rates.employmentInsurance)));
      }
    }
    const net = gross - deduction;
    tg += gross; td += deduction; tn += net;
    console.log(`- ${name.padEnd(6)} [${TIER_LABEL[elig.tier]}/${elig.incomeType === "EMPLOYMENT" ? "근로" : "사업"}] ${workedDays}일 ${workedHours}h`);
    console.log(`    지급 ${won(gross)} − 공제 ${won(deduction)} (${ded.join(", ") || "없음"}) = 실수령 ${won(net)}`);
  }
  console.log(`\n합계: 지급 ${won(tg)} · 공제 ${won(td)} · 실수령 ${won(tn)}\n`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
