// scripts/backfill-trainee-placements.mts
// 기존 훈련생(현재 재적·배치이력 없음)에 ACTIVE TraineePlacement 백필.
// startDate = 해당 현장의 최초 배정 시작일(없으면 트레이니 생성일, 그것도 없으면 2026-01-01).
// 운영은 훈련생 0이라 무영향(dev 테스트 데이터 정정용). 멱등: 이미 열린 배치 있으면 건너뜀.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const FALLBACK = new Date("2026-01-01T00:00:00+09:00");

async function main() {
  const trainees = await prisma.trainee.findMany({
    where: { status: { in: ["TRAINING", "EMPLOYED"] }, currentSiteId: { not: null } },
    select: { id: true, name: true, currentSiteId: true, createdAt: true },
  });
  console.log(`대상 활성 훈련생: ${trainees.length}`);

  // 현장별 최초 배정 시작일 캐시
  const siteStart = new Map<string, Date>();
  let created = 0, skipped = 0;
  for (const t of trainees) {
    const siteId = t.currentSiteId!;
    // 이미 열린 ACTIVE 배치가 있으면 건너뜀(멱등)
    const open = await prisma.traineePlacement.findFirst({
      where: { traineeId: t.id, status: "ACTIVE", endDate: null }, select: { id: true },
    });
    if (open) { skipped++; continue; }

    const key = siteId.toString();
    if (!siteStart.has(key)) {
      const asg = await prisma.siteAssignment.findFirst({
        where: { siteId }, orderBy: { startDate: "asc" }, select: { startDate: true },
      });
      siteStart.set(key, asg?.startDate ?? t.createdAt ?? FALLBACK);
    }
    const startDate = siteStart.get(key)!;
    await prisma.traineePlacement.create({
      data: { traineeId: t.id, siteId, startDate, status: "ACTIVE" },
    });
    created++;
  }
  const total = await prisma.traineePlacement.count();
  console.log(`생성: ${created} · 건너뜀(기존): ${skipped} · TraineePlacement 총계: ${total}`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
