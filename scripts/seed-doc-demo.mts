// scripts/seed-doc-demo.mts
// 대시보드 '제출 문서 현황'(확정 대기/서명 대기) + '일지 관리(/manager/documents)' 테스트용 샘플.
// manager01 소속 기관의 활성 배정에 DocumentRun(+Version)을 생성한다.
//   확정 대기 = signStage "SUBMITTED" 2건 · 서명 대기 = "CONFIRMED" 2건.
// 멱등(재실행 안전): 사용한 배정의 데모 문서런을 먼저 제거 후 재생성.
// 실행:  npx tsx scripts/seed-doc-demo.mts
// 제거:  npx tsx scripts/seed-doc-demo.mts --clean
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

function daysFromNow(d: number) { return new Date(Date.now() + d * 86400000); }

// [SUBMITTED, SUBMITTED, CONFIRMED, CONFIRMED] — 확정 대기 2 · 서명 대기 2
const PLAN: { stage: string }[] = [
  { stage: "SUBMITTED" }, { stage: "SUBMITTED" },
  { stage: "CONFIRMED" }, { stage: "CONFIRMED" },
];

async function main() {
  const manager = await prisma.manager.findFirst({
    where: { loginId: "manager01" },
    select: { id: true, agencyId: true, agency: { select: { name: true } } },
  });
  if (!manager) throw new Error("manager01 없음");
  const agencyId = manager.agencyId;

  const asgs = await prisma.siteAssignment.findMany({
    where: { status: "ACTIVE", agencyId },
    select: { id: true, siteId: true, workerId: true, user: { select: { workerName: true } }, site: { select: { companyName: true } } },
    orderBy: { id: "asc" },
    take: PLAN.length,
  });
  if (asgs.length === 0) throw new Error("활성 배정 없음 — 먼저 배정 데이터가 필요합니다.");

  // 멱등 제거: 사용 대상 배정의 출근부 문서런(version은 cascade) 제거
  const asgIds = asgs.map(a => a.id);
  await prisma.documentRun.deleteMany({ where: { agencyId, assignmentId: { in: asgIds }, docType: "ATTENDANCE_SHEET" } });
  if (CLEAN) { console.log(`데모 제출문서 제거 완료(${asgIds.length}개 배정 대상).`); return; }

  const periodStart = new Date(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01T00:00:00+09:00`);
  const periodEnd = daysFromNow(0);

  let made = 0;
  for (let i = 0; i < asgs.length; i++) {
    const a = asgs[i];
    const { stage } = PLAN[i % PLAN.length];
    const run = await prisma.documentRun.create({
      data: {
        agencyId, assignmentId: a.id, siteId: a.siteId, workerId: a.workerId,
        docType: "ATTENDANCE_SHEET",
        periodStart, periodEnd,
        openAt: periodStart, dueAt: periodEnd,
        signStage: stage,
        govStatus: "NONE",
        workerSignedAt: daysFromNow(-3),
      },
    });
    const ver = await prisma.documentVersion.create({
      data: { runId: run.id, versionNo: 1, stage: "FINAL", pdfUrl: "", sourceData: {}, createdByWorkerId: a.workerId },
    });
    await prisma.documentRun.update({ where: { id: run.id }, data: { currentVersionId: ver.id } });
    made++;
    const label = stage === "SUBMITTED" ? "확정 대기" : "서명 대기";
    console.log(`  제출문서 ✓ ${a.user?.workerName} · ${a.site?.companyName} [${label}]`);
  }
  console.log(`\n제출 문서 샘플 ${made}건 생성 완료 (manager01/${manager.agency?.name}). 확정대기 2 · 서명대기 2.`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
