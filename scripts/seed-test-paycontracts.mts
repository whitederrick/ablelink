// scripts/seed-test-paycontracts.mts
// 테스트 위탁기관의 활성 배정 직무지도원에게 급여 기준(시급 10,320) 시드. 멱등(겹치면 skip).
// 실행: npx tsx scripts/seed-test-paycontracts.mts
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const BASE = 10320, EFF_FROM = new Date("2026-01-01");
const ag = await p.dailyAttendance.findFirst({ where: { isFinalClosed: true }, orderBy: { workDate: "desc" }, select: { assignment: { select: { agencyId: true } } } });
const agencyId = ag?.assignment?.agencyId;
const agency = agencyId ? await p.agency.findUnique({ where: { id: agencyId }, select: { name: true } }) : null;
if (!agencyId || !agency?.name?.includes("테스트")) {
  console.log(`⛔ 안전 가드: 대상 에이전시(${agency?.name})가 '테스트'가 아닙니다. 중단.`);
  await p.$disconnect(); process.exit(1);
}
const assigns = await p.siteAssignment.findMany({ where: { agencyId, status: "ACTIVE" }, select: { workerId: true } });
const workerIds = [...new Set(assigns.map(a => a.workerId.toString()))].map(s => BigInt(s));
let created = 0, skipped = 0;
for (const workerId of workerIds) {
  const exists = await p.payContract.findFirst({ where: { agencyId, workerId, effectiveFrom: { lte: new Date("2026-06-01") }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2026-06-30") } }] }, select: { id: true } });
  if (exists) { skipped++; continue; }
  const data: any = { agencyId, workerId, workerType: "EXTERNAL", payType: "HOURLY", baseAmount: BASE, currency: "KRW", incomeType: "EMPLOYMENT", hourlyRate2Plus: Math.round(BASE * 1.2), weeklyHolidayPay: Math.round(BASE * 8), effectiveFrom: EFF_FROM, effectiveTo: null };
  await p.payContract.create({ data });
  created++;
}
console.log(`✅ ${agency.name}: 급여 기준 생성 ${created}건 / 건너뜀 ${skipped}건 (대상 워커 ${workerIds.length}명)`);
await p.$disconnect();
