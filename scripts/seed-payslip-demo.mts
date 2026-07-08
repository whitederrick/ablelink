// scripts/seed-payslip-demo.mts
// 워커 급여명세서 화면(로컬 시각검증)용 데모 데이터 — 확정(FINALIZED) 급여 3개월치.
// 대상 워커 비번을 worker1234!로 리셋(로그인 보장). 재실행 안전(upsert). 개발 DB 전용(_dbGuard).
// 실행: npx tsx scripts/seed-payslip-demo.mts
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertWritableDb } from "./_dbGuard.mts";

const prisma = new PrismaClient();
const TARGET_LOGIN = "01070000000"; // 강도윤

type Line = { key: string; name: string; hours?: number; amount: number; method?: string };
function breakdown(payLines: Line[], deductLines: Line[], workedDays: number, ot: number, night: number) {
  return {
    payType: "HOURLY",
    payLines,
    deductLines,
    basicInfo: { job: "직무지도", placementType: "지원고용 현장훈련", placementDate: "2025-12-01", dependents: 1, childUnder20: 0, withholdingRate: 100 },
    calcMethods: {},
    overtimeHours: ot, nightHours: night, holidayHours: 0,
    pensionBase: 1100000, totalHours: workedDays * 4 + 8,
    incomeType: "EMPLOYMENT",
    insurance: {
      incomeType: "EMPLOYMENT", tier: "REGULAR",
      insurances: ["pension", "health", "ltc", "employment", "industrial"],
      workerDeductible: ["pension", "health", "ltc", "employment"],
      needsPensionReview: false, employerIndustrial: 8000, rateYear: 2026, taxYear: 2026,
      employmentMonths: 6, monthlyHours: workedDays * 4, monthlyDays: workedDays, continuousMonths: 6,
    },
  };
}

const MONTHS = [
  {
    ym: "2026-01", workedDays: 18, workedMinutes: 18 * 4 * 60, ot: 0, night: 0,
    payLines: [
      { key: "support1", name: "1인지원", hours: 72, amount: 888000, method: "지원시간 × 12,000원" },
      { key: "weeklyHoliday", name: "주휴수당", hours: 8, amount: 96000, method: "(주 소정 40h) 기준" },
    ] as Line[],
    deductLines: [
      { key: "incomeTax", name: "소득세", amount: 9000 }, { key: "localTax", name: "주민세", amount: 900 },
      { key: "pension", name: "국민연금", amount: 44000 }, { key: "health", name: "건강보험", amount: 34000 },
      { key: "employment", name: "고용보험", amount: 8800 }, { key: "ltc", name: "장기요양보험", amount: 4400 },
    ] as Line[],
  },
  {
    ym: "2026-02", workedDays: 20, workedMinutes: 20 * 4 * 60 + 300, ot: 5, night: 2,
    payLines: [
      { key: "support1", name: "1인지원", hours: 80, amount: 960000, method: "지원시간 × 12,000원" },
      { key: "overtime", name: "연장근로수당", hours: 5, amount: 90000, method: "5시간 × 12,000원 × 1.5" },
      { key: "night", name: "야간근로수당", hours: 2, amount: 12000, method: "2시간 × 12,000원 × 0.5" },
      { key: "weeklyHoliday", name: "주휴수당", hours: 8, amount: 96000, method: "(주 소정 40h) 기준" },
    ] as Line[],
    deductLines: [
      { key: "incomeTax", name: "소득세", amount: 12000 }, { key: "localTax", name: "주민세", amount: 1200 },
      { key: "pension", name: "국민연금", amount: 49500 }, { key: "health", name: "건강보험", amount: 39000 },
      { key: "employment", name: "고용보험", amount: 8800 }, { key: "ltc", name: "장기요양보험", amount: 5000 },
    ] as Line[],
  },
  {
    ym: "2026-03", workedDays: 22, workedMinutes: 22 * 4 * 60 + 480, ot: 8, night: 0,
    payLines: [
      { key: "support1", name: "1인지원", hours: 92, amount: 1104000, method: "지원시간 × 12,000원" },
      { key: "overtime", name: "연장근로수당", hours: 8, amount: 90000, method: "8시간 × 12,000원 × 1.5(근사)" },
      { key: "weeklyHoliday", name: "주휴수당", hours: 8, amount: 96000, method: "(주 소정 40h) 기준" },
    ] as Line[],
    deductLines: [
      { key: "incomeTax", name: "소득세", amount: 14000 }, { key: "localTax", name: "주민세", amount: 1400 },
      { key: "pension", name: "국민연금", amount: 55000 }, { key: "health", name: "건강보험", amount: 43000 },
      { key: "employment", name: "고용보험", amount: 9800 }, { key: "ltc", name: "장기요양보험", amount: 5500 },
    ] as Line[],
  },
];

async function main() {
  assertWritableDb("급여명세서 데모 시드");
  const worker = await prisma.worker.findUnique({ where: { loginId: TARGET_LOGIN }, select: { id: true, workerName: true } });
  if (!worker) { console.log(`⚠️ 워커(${TARGET_LOGIN}) 없음`); return; }
  const asg = await prisma.siteAssignment.findFirst({ where: { workerId: worker.id, agencyId: { not: null } }, select: { agencyId: true } });
  const agencyId = asg?.agencyId;
  if (!agencyId) { console.log("⚠️ 워커의 agency 배정 없음"); return; }

  // 로그인 보장: 비번 리셋
  const hash = await bcrypt.hash("worker1234!", 10);
  await prisma.worker.update({ where: { id: worker.id }, data: { password: hash, birthDate: "1990-03-15", bankName: "국민은행", accountNumber: "123456-01-987654", accountHolder: worker.workerName } });

  for (const m of MONTHS) {
    const gross = m.payLines.reduce((s, l) => s + l.amount, 0);
    const deduction = m.deductLines.reduce((s, l) => s + l.amount, 0);
    const net = gross - deduction;
    const bd = breakdown(m.payLines, m.deductLines, m.workedDays, m.ot, m.night);

    const run = await prisma.payrollRun.upsert({
      where: { agencyId_yearMonth: { agencyId, yearMonth: m.ym } },
      update: { status: "FINALIZED", finalizedAt: new Date(`${m.ym}-10T00:00:00+09:00`) },
      create: { agencyId, yearMonth: m.ym, status: "FINALIZED", finalizedAt: new Date(`${m.ym}-10T00:00:00+09:00`) },
      select: { id: true },
    });
    await prisma.payrollItem.upsert({
      where: { runId_workerId: { runId: run.id, workerId: worker.id } },
      update: { grossPay: gross, totalDeduction: deduction, netPay: net, workedDays: m.workedDays, workedMinutes: m.workedMinutes, breakdown: bd as Prisma.InputJsonValue },
      create: { runId: run.id, workerId: worker.id, grossPay: gross, totalDeduction: deduction, netPay: net, workedDays: m.workedDays, workedMinutes: m.workedMinutes, breakdown: bd as Prisma.InputJsonValue },
    });
    console.log(`✅ ${m.ym}: 지급 ${gross.toLocaleString()} · 공제 ${deduction.toLocaleString()} · 실지급 ${net.toLocaleString()}`);
  }

  console.log(`\n🎯 로그인: ${TARGET_LOGIN} / worker1234!  → /worker/payroll 에서 확인`);
  console.log(`   워커: ${worker.workerName} (id=${worker.id}, agency=${agencyId})`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
