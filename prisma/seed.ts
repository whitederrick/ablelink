// prisma/seed.ts — 개발용 초기 데이터 생성
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hash = (pw: string) => bcrypt.hash(pw, 12);

  // ─── 1. 에이전시 ───────────────────────────────────────────
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
      isActive: true,
    },
  });
  console.log("✅ 에이전시:", agency.name, "(id:", agency.id.toString(), ")");

  // ─── 2. 시스템 운영자 계정 (ADMIN role) ────────────────────
  const admin = await prisma.adminUser.upsert({
    where: { loginId: "admin" },
    update: {},
    create: {
      loginId: "admin",
      passwordHash: await hash("admin1234!"),
      displayName: "시스템 운영자",
      role: "ADMIN",
      isActive: true,
    },
  });
  console.log("✅ 시스템 운영자:", admin.loginId, "/ PW: admin1234!");

  // ─── 3. 에이전시 관리자 계정 (AGENCY role) ─────────────────
  const manager = await prisma.adminUser.upsert({
    where: { loginId: "manager01" },
    update: {},
    create: {
      loginId: "manager01",
      passwordHash: await hash("Manager1234!"),
      displayName: "김매니저",
      role: "AGENCY",
      agencyId: agency.id,
      isActive: true,
    },
  });
  console.log("✅ 에이전시 관리자:", manager.loginId, "/ PW: Manager1234!");

  // ─── 4. 직무지도원 계정 ────────────────────────────────────
  const worker = await prisma.user.upsert({
    where: { loginId: "worker01" },
    update: {},
    create: {
      loginId: "worker01",
      password: await hash("worker1234!"),
      userName: "김지도",
      phoneNumber: "010-1234-5678",
      planType: "PREMIUM",
      status: "ACTIVE",
    },
  });
  console.log("✅ 직무지도원:", worker.loginId, "(id:", worker.id.toString(), ")");

  // ─── 5. 사업장 ─────────────────────────────────────────────
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
  console.log("✅ 사업장:", site.companyName, "(id:", site.id.toString(), ")");

  // ─── 6. 배정 ───────────────────────────────────────────────
  const assignment = await prisma.siteAssignment.upsert({
    where: { id: BigInt(1) },
    update: {},
    create: {
      userId: worker.id,
      siteId: site.id,
      agencyId: agency.id,
      assignedByAdminId: manager.id,
      status: "ACTIVE",
      serviceStep: "FIELD_TRAINING",
      attendanceMode: "APP_GPS",
      startDate: new Date("2026-01-01"),
      isMainCoach: true,
    },
  });
  console.log("✅ 배정 완료 (id:", assignment.id.toString(), ")");

  // ─── 7. 훈련생 ─────────────────────────────────────────────
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
  console.log("✅ 훈련생:", trainee.name, "(id:", trainee.id.toString(), ")");

  // ─── 8. 출근 기록 (오늘 날짜 기준, 완료 상태) ──────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const yestStr  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  // 오늘 출근기록 (미확정 — 수정/확정 테스트용)
  let att1 = await prisma.dailyAttendance.findUnique({
    where: { assignmentId_workDate: { assignmentId: assignment.id, workDate: todayStr } },
  });
  if (!att1) {
    att1 = await prisma.dailyAttendance.create({
      data: {
        userId:       worker.id,
        siteId:       site.id,
        assignmentId: assignment.id,
        workDate:     todayStr,
        startTime:    new Date(`${todayStr}T00:00:00Z`), // KST 09:00
        endTime:      new Date(`${todayStr}T06:00:00Z`), // KST 15:00
        status:       "DONE",
        isFinalClosed: false,
      },
    });
  }
  console.log("✅ 출근기록(오늘):", att1.id.toString(), "workDate:", todayStr);

  // 어제 출근기록 (확정 완료 — 일지 CRUD 테스트용)
  let att2 = await prisma.dailyAttendance.findUnique({
    where: { assignmentId_workDate: { assignmentId: assignment.id, workDate: yestStr } },
  });
  if (!att2) {
    att2 = await prisma.dailyAttendance.create({
      data: {
        userId:       worker.id,
        siteId:       site.id,
        assignmentId: assignment.id,
        workDate:     yestStr,
        startTime:    new Date(`${yestStr}T00:00:00Z`),
        endTime:      new Date(`${yestStr}T06:00:00Z`),
        status:       "DONE",
        isFinalClosed: false,
      },
    });
  }
  console.log("✅ 출근기록(어제):", att2.id.toString(), "workDate:", yestStr);

  console.log("\n🎉 시드 완료!");
  console.log("─────────────────────────────────────────");
  console.log("시스템 운영자  loginId: admin      / PW: admin1234!");
  console.log("에이전시 관리자 loginId: manager01  / PW: Manager1234!");
  console.log("직무지도원     loginId: worker01   / PW: worker1234!");
  console.log("─────────────────────────────────────────");
  console.log("사업장 id:", site.id.toString());
  console.log("배정 id:", assignment.id.toString());
  console.log("훈련생 id:", trainee.id.toString());
  console.log("출근기록(오늘) id:", att1.id.toString());
  console.log("출근기록(어제) id:", att2.id.toString());
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
