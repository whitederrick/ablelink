// prisma/seed.ts — 개발용 초기 데이터 생성
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hash = (pw: string) => bcrypt.hash(pw, 10);

  // 1. 에이전시
  const agency = await prisma.agency.upsert({
    where: { name: "테스트 에이전시" },
    update: {},
    create: {
      name: "테스트 에이전시",
      phoneNumber: "02-1234-5678",
      address: "서울시 강남구 테헤란로 1",
      planType: "STANDARD",
      maxCoaches: 30,
      maxSites: 30,
    },
  });
  console.log("✅ 에이전시:", agency.name);

  // 2. 관리자 계정
  const admin = await prisma.adminUser.upsert({
    where: { loginId: "admin" },
    update: {},
    create: {
      loginId: "admin",
      passwordHash: await hash("admin1234!"),
      displayName: "테스트 관리자",
      role: "ADMIN",
      agencyId: agency.id,
      isActive: true,
    },
  });
  console.log("✅ 관리자:", admin.loginId, "/ 비밀번호: admin1234!");

  // 3. 직무지도원 계정
  const worker = await prisma.user.upsert({
    where: { loginId: "worker01" },
    update: {},
    create: {
      loginId: "worker01",
      password: await hash("worker1234!"),
      userName: "김지도",
      phoneNumber: "010-1234-5678",
      planType: "PREMIUM",
    },
  });
  console.log("✅ 직무지도원:", worker.loginId, "/ 비밀번호: worker1234!");

  // 4. 사업장
  const site = await prisma.site.upsert({
    where: { id: BigInt(1) },
    update: {},
    create: {
      companyName: "테스트 사업장",
      address: "서울시 마포구 합정동 1-1",
      gpsLat: 37.549,
      gpsLon: 126.913,
      allowanceRange: 300,
      agencyId: agency.id,
      isVerified: true,
      isActive: true,
    },
  });
  console.log("✅ 사업장:", site.companyName);

  // 5. 배정
  const assignment = await prisma.siteAssignment.upsert({
    where: { id: BigInt(1) },
    update: {},
    create: {
      userId: worker.id,
      siteId: site.id,
      agencyId: agency.id,
      assignedByAdminId: admin.id,
      status: "ACTIVE",
      serviceStep: "FIELD_TRAINING",
      attendanceMode: "APP_GPS",
      startDate: new Date("2026-01-01"),
      isMainCoach: true,
    },
  });
  console.log("✅ 배정 완료 (assignmentId:", assignment.id.toString(), ")");

  // 6. 훈련생
  const trainee = await prisma.trainee.upsert({
    where: { id: BigInt(1) },
    update: {},
    create: {
      name: "테스트 훈련생",
      gender: "M",
      disabilityType: "지적장애",
      severity: "2급",
      currentSiteId: site.id,
      status: "TRAINING",
    },
  });
  console.log("✅ 훈련생:", trainee.name);

  console.log("\n🎉 시드 완료!");
  console.log("─────────────────────────────────");
  console.log("관리자  loginId: admin      / PW: admin1234!");
  console.log("직무지도원 loginId: worker01 / PW: worker1234!");
  console.log("─────────────────────────────────");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
