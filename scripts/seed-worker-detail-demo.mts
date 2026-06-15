// 직무지도원 상세 모달(과거 계약 이력·만족도 평가) 페이징 검증용 시드.
// 기관1의 한 직무지도원에게 과거 계약(ENDED) 5건 + 전달된 만족도 평가 5건을 추가한다.
//   npx tsx scripts/seed-worker-detail-demo.mts          → 시드
//   npx tsx scripts/seed-worker-detail-demo.mts --clean   → 시드 데이터만 삭제
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const AG = BigInt(1);
const TAG = "[detail-demo]"; // 코멘트/삭제 식별 태그

// 1) 대상 직무지도원 — 기관1 현장에 배정 이력이 있는 첫 워커
const worker = await prisma.worker.findFirst({
  where: { assignments: { some: { site: { agencyId: AG } } } },
  orderBy: { id: "asc" },
  select: { id: true, workerName: true, loginId: true },
});
if (!worker) { console.error("기관1 소속 직무지도원을 찾지 못했습니다."); await prisma.$disconnect(); process.exit(1); }

// 기존 시드 정리(태그로 식별)
const delSurvey = await prisma.satisfactionSurvey.deleteMany({ where: { workerId: worker.id, agencyId: AG, comment: { startsWith: TAG } } });
const delAssign = await prisma.siteAssignment.deleteMany({ where: { workerId: worker.id, agencyId: AG, status: "ENDED", customWorkEnd: TAG } });
console.log(`정리: 평가 ${delSurvey.count}건 · 과거계약 ${delAssign.count}건 삭제`);

if (process.argv.includes("--clean")) { console.log("정리만 수행 완료."); await prisma.$disconnect(); process.exit(0); }

// 2) 기관1 현장 목록(과거 계약·평가 siteName 용)
const sites = await prisma.site.findMany({ where: { agencyId: AG }, orderBy: { id: "asc" }, take: 6, select: { id: true, companyName: true } });
if (sites.length === 0) { console.error("기관1 현장이 없습니다."); await prisma.$disconnect(); process.exit(1); }
const pick = (i: number) => sites[i % sites.length];

const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);
const WORK = ["AM", "PM", "FULL_DAY"];
const STEP = ["FIELD_TRAINING", "ADAPTATION"] as const;

// 3) 과거 계약(ENDED) 5건 — 페이징 확인용(3+2)
const N = 5;
for (let i = 0; i < N; i++) {
  const s = pick(i);
  await prisma.siteAssignment.create({
    data: {
      workerId: worker.id, siteId: s.id, agencyId: AG, status: "ENDED",
      startDate: day(-120 - i * 40), endDate: day(-90 - i * 40),
      workType: WORK[i % WORK.length], serviceStep: STEP[i % STEP.length],
      customWorkEnd: TAG, // 시드 식별용(표시에는 영향 없음)
    },
  });
}

// 4) 만족도 평가(전달완료) 5건 — 점수/코멘트 노출
for (let i = 0; i < N; i++) {
  const s = pick(i);
  await prisma.satisfactionSurvey.create({
    data: {
      agencyId: AG, workerId: worker.id, recipientPhone: "010-0000-0000",
      siteName: s.companyName, token: `${TAG}-${worker.id}-${i}-${Date.now()}`,
      status: "RESPONDED", overallScore: 3 + (i % 3), sharedWithAgency: true,
      comment: `${TAG} 평가 ${i + 1} — 성실하게 지도해주셨습니다.`,
      respondedAt: day(-80 - i * 30), expiresAt: day(-70 - i * 30),
    },
  });
}

console.log(`완료: 직무지도원 ${worker.workerName}(${worker.loginId}, id=${worker.id}) — 과거계약 ${N}건 · 평가 ${N}건 추가`);
await prisma.$disconnect();
