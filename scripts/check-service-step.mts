// scripts/check-service-step.mts
// 진단용: 배정(SiteAssignment)별 serviceStep 분포 + TraineeLog trainingType 분포 확인.
// 실행: npx tsx scripts/check-service-step.mts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const byStep = await prisma.siteAssignment.groupBy({
    by: ["serviceStep", "status"],
    _count: { _all: true },
  });
  console.log("=== SiteAssignment serviceStep × status ===");
  for (const r of byStep) console.log(`  ${r.serviceStep.padEnd(16)} ${String(r.status).padEnd(10)} ${r._count._all}`);

  const logByType = await prisma.traineeLog.groupBy({
    by: ["trainingType"],
    _count: { _all: true },
  });
  console.log("\n=== TraineeLog trainingType ===");
  for (const r of logByType) console.log(`  ${String(r.trainingType).padEnd(16)} ${r._count._all}`);

  console.log("\n=== 활성 배정 상세 (최근 20) ===");
  const rows = await prisma.siteAssignment.findMany({
    where: { status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } },
    select: {
      id: true, serviceStep: true, status: true, startDate: true, endDate: true,
      site: { select: { companyName: true } },
      user: { select: { workerName: true } },
    },
    orderBy: { assignedAt: "desc" },
    take: 20,
  });
  for (const a of rows) {
    console.log(`  #${a.id} ${a.serviceStep.padEnd(16)} ${(a.site?.companyName ?? "-").padEnd(12)} ${(a.user?.workerName ?? "-").padEnd(8)} ${a.status}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
