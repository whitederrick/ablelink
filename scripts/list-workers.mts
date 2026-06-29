// scripts/list-workers.mts — 전체 직무지도원 + 위탁기관 관계 리스트
import { prisma } from "../lib/prisma";

async function main() {
  const workers = await prisma.worker.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true, loginId: true, workerName: true, phoneNumber: true, status: true,
      planType: true, openToOffers: true,
      assignments: {
        select: { status: true, agency: { select: { name: true } }, site: { select: { companyName: true } } },
        orderBy: { startDate: "desc" },
      },
    },
  });

  for (const w of workers) {
    const rels = w.assignments.map(a => `${a.agency?.name ?? "-"}[${a.status}]`).join(" / ") || "(배정없음)";
    console.log(`${w.id}\t${w.workerName}\t${w.phoneNumber}\t${w.status}\t${w.planType}\t${w.openToOffers ? "구직중" : ""}\t${rels}`);
  }
  console.log(`\n총 ${workers.length}명`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
