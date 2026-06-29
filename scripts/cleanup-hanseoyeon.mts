// scripts/cleanup-hanseoyeon.mts — 한서연(인재풀)의 데모현장 잘못된 배정 정리
import { prisma } from "../lib/prisma";

async function main() {
  const workers = await prisma.worker.findMany({ where: { workerName: "한서연" }, select: { id: true, loginId: true } });
  if (workers.length === 0) { console.log("한서연 없음"); return; }

  for (const w of workers) {
    const asgs = await prisma.siteAssignment.findMany({
      where: { workerId: w.id },
      select: { id: true, status: true, site: { select: { companyName: true } } },
    });
    console.log(`\n한서연(id=${w.id}, ${w.loginId}) 배정 ${asgs.length}건:`);
    for (const a of asgs) console.log(`  asg ${a.id} [${a.status}] ${a.site?.companyName}`);

    // 데모현장 배정만 제거
    const demo = asgs.filter(a => (a.site?.companyName ?? "").includes("데모"));
    if (demo.length === 0) { console.log("  → 데모현장 배정 없음, 건너뜀"); continue; }
    const res = await prisma.siteAssignment.deleteMany({ where: { id: { in: demo.map(d => d.id) } } });
    console.log(`  → 데모현장 배정 ${res.count}건 삭제`);
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
