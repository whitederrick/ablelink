// scripts/seed-test-link.mts
// 테스트용: 기존 worker 계정을 manager의 에이전시에 연결(현장+담당자+배정+훈련생+서명계약).
// → 직무지도원이 문서를 생성하면 매니저 서명이 (위탁기관/공단) 담당자란에 반영되는지 테스트 가능.
// 실행: npx tsx scripts/seed-test-link.mts   (운영=dev DB이므로 사용자 승인 후 실행)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const worker = await prisma.worker.findUnique({ where: { loginId: "worker" } });
  const manager = await prisma.manager.findUnique({ where: { loginId: "manager" } });
  if (!worker) throw new Error("worker 계정(loginId=worker)이 없습니다.");
  if (!manager) throw new Error("manager 계정(loginId=manager)이 없습니다.");
  const agencyId = manager.agencyId;

  // 1) 에이전시 플랜 STANDARD 보장 (PDF 생성 = STARTER+ 필요)
  await prisma.agency.update({
    where: { id: agencyId },
    data: { planType: "STANDARD", maxWorkers: 30, maxSites: 30, isActive: true },
  });

  // 2) 현장 — find-or-create (서울시청 좌표). 사업체 담당자는 Site에 직접 저장.
  const businessContact = {
    businessContactName: "테스트 사업체담당자",
    businessContactPhone: "01000000000",
    businessContactEmail: "test-contact@able-link.co.kr",
  };
  let site = await prisma.site.findFirst({ where: { agencyId, companyName: "테스트 연계현장" } });
  if (!site) {
    site = await prisma.site.create({
      data: {
        companyName: "테스트 연계현장",
        address: "서울특별시 중구 세종대로 110",
        gpsLat: 37.5663, gpsLon: 126.9779,
        agencyId, ...businessContact,
        basePointConfirmed: true, basePointSource: "ADDRESS", basePointUpdatedAt: new Date(),
        isActive: true,
      },
    });
  } else {
    site = await prisma.site.update({ where: { id: site.id }, data: { ...businessContact, isActive: true } });
  }

  // 4) 훈련생 2명 (없을 때만)
  const traineeCount = await prisma.trainee.count({ where: { currentSiteId: site.id } });
  if (traineeCount === 0) {
    await prisma.trainee.createMany({
      data: [
        { currentSiteId: site.id, name: "김훈련", gender: "M", disabilityType: "지적장애", severity: "중증", status: "TRAINING", birthDate: "20000101", phoneNumber: "01011112222" },
        { currentSiteId: site.id, name: "이연습", gender: "F", disabilityType: "자폐성장애", severity: "중증", status: "TRAINING", birthDate: "20010202", phoneNumber: "01033334444" },
      ],
    });
  }

  // 5) 배정 (worker ↔ site/agency, assignedByManager = manager). startDate=오늘0시(최신·필터 통과)
  const startDate = new Date(); startDate.setHours(0, 0, 0, 0);
  let assignment = await prisma.siteAssignment.findFirst({ where: { workerId: worker.id, siteId: site.id } });
  if (!assignment) {
    assignment = await prisma.siteAssignment.create({
      data: {
        workerId: worker.id, siteId: site.id, agencyId, status: "ACTIVE",
        assignedByManagerId: manager.id, serviceStep: "FIELD_TRAINING",
        startDate, workType: "FULL_DAY", commuteGuidanceIncluded: false,
      },
    });
  } else {
    assignment = await prisma.siteAssignment.update({
      where: { id: assignment.id },
      data: { status: "ACTIVE", agencyId, assignedByManagerId: manager.id, startDate, endDate: null, workType: "FULL_DAY" },
    });
  }

  // 6) 이 워커의 다른 ACTIVE 배정은 날짜로 가려 이 배정이 '현재 현장'이 되게 함(데이터 보존: 종료만)
  const shadowed = await prisma.siteAssignment.updateMany({
    where: { workerId: worker.id, status: "ACTIVE", id: { not: assignment.id }, OR: [{ endDate: null }, { endDate: { gte: startDate } }] },
    data: { endDate: new Date(startDate.getTime() - 86400000) },
  });

  // 7) 서명 근로계약(SIGNED) → 워커 docAccess(계약 기반, 에이전시 STANDARD)
  const contractStart = new Date(); contractStart.setMonth(contractStart.getMonth() - 1); contractStart.setHours(0, 0, 0, 0);
  const contractEnd = new Date(); contractEnd.setMonth(contractEnd.getMonth() + 5);
  const existingContract = await prisma.employmentContract.findFirst({
    where: { workerId: worker.id, agencyId, status: { in: ["SIGNED", "COMPLETED"] } },
  });
  if (!existingContract) {
    await prisma.employmentContract.create({
      data: {
        agencyId, workerId: worker.id, assignmentId: assignment.id,
        contractStart, contractEnd,
        siteName: site.companyName, workType: "FULL_DAY",
        signToken: "testlink-" + Math.random().toString(36).slice(2, 12),
        tokenExpiresAt: contractEnd,
        status: "SIGNED", workerSignedAt: new Date(),
        createdByManagerId: manager.id,
      },
    });
  }

  console.log("✅ 연결 완료");
  console.log(`   worker(${worker.loginId}, id=${worker.id}) → agency(id=${agencyId})`);
  console.log(`   site=${site.id}(${site.companyName}), 사업체담당자=${businessContact.businessContactName}`);
  console.log(`   assignment=${assignment.id} (assignedByManager=${manager.id}/${manager.displayName ?? "manager"})`);
  console.log(`   가려진 기존 ACTIVE 배정: ${shadowed.count}건`);
  console.log("   → 매니저(/manager/signature)에서 서명 등록 후, 워커가 문서 생성 시 담당자 서명에 반영됩니다.");
}

main()
  .catch(e => { console.error("❌", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
