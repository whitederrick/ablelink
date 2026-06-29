// AI 사용량 데모 — 이번 달 기관별 ApiCallLog(직무지도원 포함) 재생성.
import { prisma } from "../lib/prisma";

const SERVICES = ["GROQ_STT", "GEMINI_LOG", "GEMINI_BATCH"];
function rnd(min: number, max: number) { return min + Math.floor(Math.random() * (max - min + 1)); }
function pick<T>(a: T[]): T | null { return a.length ? a[Math.floor(Math.random() * a.length)] : null; }

async function main() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const maxDay = Math.min(28, now.getDate());

  await prisma.apiCallLog.deleteMany({}); // 기존 데모 정리

  const agencies = await prisma.agency.findMany({ select: { id: true } });
  const data: { agencyId: bigint; workerId: bigint | null; service: string; success: boolean; createdAt: Date }[] = [];

  for (const ag of agencies) {
    // 이 기관 소속(배정 이력) 직무지도원
    const asg = await prisma.siteAssignment.findMany({ where: { agencyId: ag.id }, select: { workerId: true }, distinct: ["workerId"] });
    const workerIds = asg.map(a => a.workerId);
    const perSvc: Record<string, number> = { GROQ_STT: rnd(40, 130), GEMINI_LOG: rnd(20, 90), GEMINI_BATCH: rnd(5, 30) };
    for (const svc of SERVICES) {
      for (let i = 0; i < perSvc[svc]; i++) {
        const d = new Date(year, month, rnd(1, maxDay), rnd(8, 19), rnd(0, 59));
        data.push({ agencyId: ag.id, workerId: pick(workerIds), service: svc, success: Math.random() > 0.03, createdAt: d });
      }
    }
  }
  for (let i = 0; i < data.length; i += 500) {
    await prisma.apiCallLog.createMany({ data: data.slice(i, i + 500) });
  }
  console.log(`AI 호출 로그 ${data.length}건 생성 (${year}-${String(month + 1).padStart(2, "0")}, 기관 ${agencies.length})`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
