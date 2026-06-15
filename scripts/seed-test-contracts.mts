// scripts/seed-test-contracts.mts
// 배정 설정 상세의 '계약서 재작성·발송 깜빡임' 테스트용.
// e2e 배정 일부에 서명완료(COMPLETED) 근로계약서를 연결해 hasContract=true 로 만든다.
//   npx tsx scripts/seed-test-contracts.mts          → 시드
//   npx tsx scripts/seed-test-contracts.mts --clean   → 시드 제거
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const MARK = "[E2E] 테스트 계약서";

if (process.argv.includes("--clean")) {
  const r = await prisma.employmentContract.deleteMany({ where: { adminMemo: MARK } });
  console.log(`정리: 테스트 계약서 ${r.count}건 삭제`);
  await prisma.$disconnect();
  process.exit(0);
}

// e2e-worker-1~5 의 활성 배정에 계약서 연결
const asgns = await prisma.siteAssignment.findMany({
  where: { user: { loginId: { startsWith: "e2e-worker-" } }, status: "ACTIVE" },
  orderBy: { id: "asc" },
  take: 5,
  select: { id: true, workerId: true, agencyId: true, workType: true, commuteGuidanceIncluded: true,
            site: { select: { companyName: true } }, user: { select: { workerName: true, loginId: true } } },
});
if (asgns.length === 0) { console.error("e2e 배정 없음 — seed-e2e.mts 먼저 실행"); await prisma.$disconnect(); process.exit(1); }

const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), 1);
const end = new Date(now.getFullYear(), now.getMonth() + 6, 0);

let n = 0;
for (const a of asgns) {
  if (a.agencyId == null) continue;
  // 이미 연결된 테스트 계약서 있으면 건너뜀(멱등)
  const exists = await prisma.employmentContract.findFirst({ where: { assignmentId: a.id, adminMemo: MARK }, select: { id: true } });
  if (exists) { continue; }
  await prisma.employmentContract.create({
    data: {
      agencyId: a.agencyId, workerId: a.workerId, assignmentId: a.id,
      contractStart: start, contractEnd: end,
      siteName: a.site?.companyName ?? null, workType: a.workType ?? "FULL_DAY",
      commuteGuidanceIncluded: a.commuteGuidanceIncluded,
      signToken: randomUUID(), tokenExpiresAt: end,
      status: "COMPLETED",
      workerSignedAt: now, adminSignedAt: now,
      adminMemo: MARK,
    },
  });
  n++;
  console.log(`  ✓ 계약서 연결: ${a.user?.workerName}(${a.user?.loginId}) → ${a.site?.companyName}`);
}
console.log(`완료: 서명완료 계약서 ${n}건 연결 (배정 설정 상세에서 근무형태/근로계약기간/출퇴근지도 변경 시 깜빡임 발동)`);
await prisma.$disconnect();
