// scripts/seed-list-demo.mts
// 목록 조회 확인용 보충 데모 데이터 — manager01(다음미래) 범위.
// seed-e2e.mts / seed-e2e-rich.mts 가 안 만드는 목록을 채운다:
//   근로계약서 20 · 만족도조사 20 · 제출문서(DocumentRun+Version) 20.
// 대상: e2e-worker-* (seed-e2e.mts 선행 필요). 멱등(재실행 안전).
// 실행:  npx tsx scripts/seed-list-demo.mts
// 제거:  npx tsx scripts/seed-list-demo.mts --clean
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

const CONTRACT_STATUS = ["PENDING", "SIGNED", "COMPLETED"];
const GOV_STATUS = ["NONE", "SUBMITTED", "RESUBMIT"];
const SIGN_STAGE = ["SUBMITTED", "MANAGER_SIGNED", "CONFIRMED"];

function daysFromNow(d: number) { return new Date(Date.now() + d * 86400000); }

async function main() {
  const manager = await prisma.manager.findFirst({ where: { loginId: "manager01" }, select: { id: true, agencyId: true, agency: { select: { name: true } } } });
  if (!manager) throw new Error("manager01 없음 — seed-e2e.mts 먼저 실행");
  const agencyId = manager.agencyId;

  // e2e 워커 + 활성 배정/현장
  const workers = await prisma.worker.findMany({
    where: { loginId: { startsWith: "e2e-worker-" } },
    select: {
      id: true, workerName: true, phoneNumber: true,
      assignments: {
        where: { status: "ACTIVE", agencyId },
        select: { id: true, siteId: true, workType: true, site: { select: { companyName: true } } },
        take: 1,
      },
    },
  });
  if (workers.length === 0) throw new Error("e2e 워커 없음 — seed-e2e.mts 먼저 실행");

  // ── 제거(공통) ──
  const wIds = workers.map(w => w.id);
  await prisma.documentRun.deleteMany({ where: { workerId: { in: wIds }, agencyId } }); // version은 cascade
  await prisma.employmentContract.deleteMany({ where: { signToken: { startsWith: "demo-contract-" } } });
  await prisma.satisfactionSurvey.deleteMany({ where: { token: { startsWith: "demo-survey-" } } });
  if (CLEAN) { console.log("보충 데모 데이터 제거 완료(계약서·만족도조사·제출문서)."); return; }

  let contracts = 0, surveys = 0, runs = 0;

  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const asg = w.assignments[0];
    if (!asg) continue;
    const siteName = asg.site?.companyName ?? "현장";

    // 1) 근로계약서
    await prisma.employmentContract.create({
      data: {
        agencyId, workerId: w.id, assignmentId: asg.id,
        contractStart: daysFromNow(-90), contractEnd: daysFromNow(275),
        siteName, workType: asg.workType,
        signToken: `demo-contract-${w.id}`,
        tokenExpiresAt: daysFromNow(14),
        status: CONTRACT_STATUS[i % CONTRACT_STATUS.length] as any,
        workerSignedAt: i % CONTRACT_STATUS.length === 0 ? null : daysFromNow(-80),
        employerBizName: manager.agency?.name ?? "다음미래",
        employerRepName: "홍길동",
      },
    });
    contracts++;

    // 2) 만족도조사
    const responded = i % 2 === 0;
    await prisma.satisfactionSurvey.create({
      data: {
        agencyId, workerId: w.id,
        recipientName: `${siteName} 담당자`,
        recipientPhone: w.phoneNumber ?? "01000000000",
        siteName,
        token: `demo-survey-${w.id}`,
        status: responded ? "RESPONDED" : "PENDING",
        expiresAt: daysFromNow(14),
        sentAt: daysFromNow(-7),
        createdByManagerId: manager.id,
        ...(responded ? {
          respondedAt: daysFromNow(-3),
          overallScore: (i % 5) + 1,
          scores: { professionalism: (i % 5) + 1, diligence: ((i + 1) % 5) + 1, communication: ((i + 2) % 5) + 1, support: ((i + 3) % 5) + 1 },
          comment: "성실하게 잘 지도해 주셨습니다.",
        } : {}),
      },
    });
    surveys++;

    // 3) 제출문서(DocumentRun + Version)
    const periodStart = new Date(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01T00:00:00+09:00`);
    const periodEnd = daysFromNow(0);
    const run = await prisma.documentRun.create({
      data: {
        agencyId, assignmentId: asg.id, siteId: asg.siteId, workerId: w.id,
        docType: "ATTENDANCE_SHEET",
        periodStart, periodEnd,
        openAt: periodStart, dueAt: periodEnd,
        signStage: SIGN_STAGE[i % SIGN_STAGE.length],
        govStatus: GOV_STATUS[i % GOV_STATUS.length],
        ...(GOV_STATUS[i % GOV_STATUS.length] === "SUBMITTED" ? { govSubmittedAt: daysFromNow(-2) } : {}),
      },
    });
    const ver = await prisma.documentVersion.create({
      data: { runId: run.id, versionNo: 1, stage: "FINAL", pdfUrl: "", sourceData: {}, createdByWorkerId: w.id },
    });
    await prisma.documentRun.update({ where: { id: run.id }, data: { currentVersionId: ver.id, workerSignedAt: daysFromNow(-5) } });
    runs++;
  }

  console.log(`보충 데모 시드 완료 — 근로계약서 ${contracts} · 만족도조사 ${surveys} · 제출문서 ${runs} (manager01/${manager.agency?.name}).`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
