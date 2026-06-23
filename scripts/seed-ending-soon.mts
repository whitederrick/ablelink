// scripts/seed-ending-soon.mts
// 대시보드 '배정 / 계약 현황 → 배정 종료 임박(D-10)' 섹션 테스트용 샘플.
// manager01(다음미래) 활성 배정 3건의 종료일을 임박(D-3/D-6/D-9)으로 설정한다.
// seed-e2e.mts 선행 필요(활성 배정 존재). 멱등(재실행 안전).
// 실행:  npx tsx scripts/seed-ending-soon.mts
// 원복:  npx tsx scripts/seed-ending-soon.mts --clean   (설정한 종료일 제거)
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

// 오늘 정오 기준 +d일 (대시보드 today<=endDate<=today+10 범위 안전 확보)
function daysFromNow(d: number) {
  const x = new Date();
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() + d);
  return x;
}

async function main() {
  const manager = await prisma.manager.findFirst({
    where: { loginId: "manager01" },
    select: { agencyId: true, agency: { select: { name: true } } },
  });
  if (!manager) throw new Error("manager01 없음 — seed-e2e.mts 먼저 실행");
  const agencyId = manager.agencyId;

  const asgs = await prisma.siteAssignment.findMany({
    where: { status: "ACTIVE", agencyId },
    select: { id: true, user: { select: { workerName: true } }, site: { select: { companyName: true } } },
    orderBy: { id: "asc" },
    take: 3,
  });
  if (asgs.length === 0) throw new Error("활성 배정 없음 — seed-e2e.mts 먼저 실행");

  if (CLEAN) {
    await prisma.siteAssignment.updateMany({ where: { id: { in: asgs.map(a => a.id) } }, data: { endDate: null } });
    console.log(`배정 종료일 원복 완료(${asgs.length}건).`);
    return;
  }

  const offsets = [3, 6, 9];
  for (let i = 0; i < asgs.length; i++) {
    const a = asgs[i];
    const dleft = offsets[i % offsets.length];
    await prisma.siteAssignment.update({ where: { id: a.id }, data: { endDate: daysFromNow(dleft) } });
    console.log(`  종료 임박 ✓ ${a.user?.workerName} → ${a.site?.companyName} (D-${dleft})`);
  }
  console.log(`\n배정 종료 임박 샘플 ${asgs.length}건 설정 완료 (manager01/${manager.agency?.name}).`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
