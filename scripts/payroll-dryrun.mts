// scripts/payroll-dryrun.mts
// 급여 계산 "읽기 전용" 드라이런 — lib/payroll/computeRun(운영과 동일 함수)을 그대로 호출해 결과만 출력.
// DB에 아무것도 쓰지 않는다. (계산/보험/세금/보정대기 게이트 모두 운영 로직과 100% 동일 — 로직 복제 제거, 감사#9)
// 실행: npx tsx scripts/payroll-dryrun.mts [YYYY-MM]
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import { PrismaClient } from "@prisma/client";
import { computePayrollItems } from "../lib/payroll/computeRun";

const prisma = new PrismaClient();
const won = (n: unknown) => Math.round(Number(n)).toLocaleString("ko-KR") + "원";
const TIER_LABEL: Record<string, string> = { DAILY_WORKER: "일용(1개월미만)", ULTRA_SHORT: "초단시간", REGULAR: "일반/상용", NONE: "사업소득" };

async function main() {
  // 대상 월: 인자 또는 isFinalClosed 출근부가 있는 가장 최근 월
  let ym = process.argv.slice(2).find(a => /^\d{4}-\d{2}$/.test(a)) || "";
  if (!ym) {
    const latest = await prisma.dailyAttendance.findFirst({ where: { isFinalClosed: true }, orderBy: { workDate: "desc" }, select: { workDate: true } });
    if (!latest) { console.log("⚠️ isFinalClosed 출근부가 없습니다. 계산할 데이터가 없습니다."); return; }
    ym = String(latest.workDate).slice(0, 7);
  }
  // 대상 에이전시: 그 달 확정 출근부가 있는 첫 에이전시
  const sample = await prisma.dailyAttendance.findFirst({
    where: { isFinalClosed: true, workDate: { gte: `${ym}-01`, lte: `${ym}-31` } },
    select: { assignment: { select: { agencyId: true } } },
  });
  const agencyId = sample?.assignment?.agencyId;
  if (!agencyId) { console.log(`⚠️ ${ym} 에 확정 출근부가 없습니다.`); return; }
  const agency = await prisma.agency.findUnique({ where: { id: agencyId }, select: { name: true } });

  // ✅ 운영과 동일한 계산 함수 호출(로직 복제 없음)
  const { items, userCount } = await computePayrollItems(agencyId, ym);

  console.log(`\n📊 급여 계산 드라이런 — ${agency?.name ?? agencyId} · ${ym}  (대상 ${userCount}명, 읽기전용·DB 미반영)`);
  if (items.length === 0) { console.log("대상 직무지도원이 없습니다.\n"); return; }

  const workers = await prisma.worker.findMany({ where: { id: { in: items.map(i => i.workerId) } }, select: { id: true, workerName: true } });
  const nameOf = new Map(workers.map(w => [w.id.toString(), w.workerName]));

  let tg = 0, td = 0, tn = 0;
  const sorted = [...items].sort((a, b) => (nameOf.get(a.workerId.toString()) ?? "").localeCompare(nameOf.get(b.workerId.toString()) ?? "", "ko"));
  for (const it of sorted) {
    const bd: any = it.breakdown ?? {};
    const name = (nameOf.get(it.workerId.toString()) ?? String(it.workerId)).padEnd(6);
    const tier = bd.insurance?.tier ? TIER_LABEL[bd.insurance.tier] ?? bd.insurance.tier : "-";
    const inc = bd.incomeType === "EMPLOYMENT" ? "근로" : bd.incomeType === "BUSINESS" ? "사업" : "-";
    const gross = Number(it.grossPay), deduction = Number(it.totalDeduction), net = Number(it.netPay);
    const dedStr = Array.isArray(bd.deductLines) && bd.deductLines.length
      ? bd.deductLines.map((d: any) => `${d.name} ${won(d.amount)}`).join(", ") : "없음";
    tg += gross; td += deduction; tn += net;
    const flags = [bd.note ? `⚠${bd.note}` : "", bd.incomeWarn ? "⚠사업소득충돌" : "", net <= 0 ? "⚠0원" : ""].filter(Boolean).join(" ");
    console.log(`- ${name} [${tier}/${inc}] ${it.workedDays}일 ${(it.workedMinutes / 60).toFixed(1)}h ${flags}`);
    console.log(`    지급 ${won(gross)} − 공제 ${won(deduction)} (${dedStr}) = 실수령 ${won(net)}`);
  }
  console.log(`\n합계: 지급 ${won(tg)} · 공제 ${won(td)} · 실수령 ${won(tn)}\n`);
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
