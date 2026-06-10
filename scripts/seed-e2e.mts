// scripts/seed-e2e.mts
// 3역할(운영자·관리자·직무지도원) 교차 테스트용 연결 시드.
// 대상 에이전시: manager01 소속(다음미래). 현장3 + 배정 직무지도원5 + 훈련생.
// 멱등(재실행 안전): 사이트=placeId upsert, 워커=loginId upsert, 배정/훈련생=마커 기반 재생성.
// 실행:  npx tsx scripts/seed-e2e.mts
// 제거:  npx tsx scripts/seed-e2e.mts --clean
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");
const WORKER_PW = "e2e1234!";

const SITES = [
  { placeId: "e2e-site-1", companyName: "[E2E] 한빛제조", address: "서울특별시 강남구 테헤란로 100", lat: 37.5012, lon: 127.0396, biz: "제조", contact: "김사장", phone: "0212340001" },
  { placeId: "e2e-site-2", companyName: "[E2E] 푸른카페", address: "서울특별시 마포구 양화로 50", lat: 37.5562, lon: 126.9230, biz: "서비스", contact: "이점장", phone: "0212340002" },
  { placeId: "e2e-site-3", companyName: "[E2E] 새봄물류", address: "경기도 성남시 분당구 판교로 200", lat: 37.3948, lon: 127.1112, biz: "유통", contact: "박팀장", phone: "0312340003" },
];

const WORKERS = [
  { loginId: "e2e-worker-1", name: "강도윤", phone: "01020000001", site: 0, workType: "FULL_DAY", step: "FIELD_TRAINING" },
  { loginId: "e2e-worker-2", name: "윤서아", phone: "01020000002", site: 0, workType: "AM",       step: "FIELD_TRAINING" },
  { loginId: "e2e-worker-3", name: "임하준", phone: "01020000003", site: 1, workType: "PM",       step: "ADAPTATION" },
  { loginId: "e2e-worker-4", name: "한지우", phone: "01020000004", site: 1, workType: "FULL_DAY", step: "FIELD_TRAINING" },
  { loginId: "e2e-worker-5", name: "오시우", phone: "01020000005", site: 2, workType: "AM",       step: "ADAPTATION" },
];

const TRAINEES = [
  { name: "정해성", gender: "M", disabilityType: "지적장애", severity: "심한", site: 0 },
  { name: "문가은", gender: "F", disabilityType: "자폐성장애", severity: "심하지않은", site: 0 },
  { name: "신유찬", gender: "M", disabilityType: "지적장애", severity: "심한", site: 1 },
  { name: "배수린", gender: "F", disabilityType: "발달장애", severity: "심한", site: 2 },
  { name: "조은우", gender: "M", disabilityType: "지체장애", severity: "심하지않은", site: 2 },
];

async function main() {
  const manager = await prisma.manager.findFirst({ where: { loginId: "manager01" }, select: { id: true, agencyId: true, agency: { select: { name: true } } } });
  if (!manager) throw new Error("manager01(관리자)가 없습니다. 운영자 콘솔에서 먼저 생성하세요.");
  const agencyId = manager.agencyId;
  console.log(`대상 에이전시: ${manager.agency?.name} (id ${agencyId}) / 관리자 manager01`);

  const e2eWorkerIds: bigint[] = [];
  const siteIds: bigint[] = [];

  if (CLEAN) {
    // 배정·훈련생 먼저 제거(FK), 그 다음 워커·사이트
    const ws = await prisma.worker.findMany({ where: { loginId: { startsWith: "e2e-worker-" } }, select: { id: true } });
    await prisma.siteAssignment.deleteMany({ where: { workerId: { in: ws.map(w => w.id) } } });
    await prisma.trainee.deleteMany({ where: { note: "[E2E]" } });
    await prisma.worker.deleteMany({ where: { loginId: { startsWith: "e2e-worker-" } } });
    await prisma.site.deleteMany({ where: { placeId: { startsWith: "e2e-site-" } } });
    console.log("E2E 시드 데이터 제거 완료.");
    return;
  }

  // 1) 현장
  for (const s of SITES) {
    const site = await prisma.site.upsert({
      where: { placeId: s.placeId },
      update: { companyName: s.companyName, address: s.address, gpsLat: s.lat, gpsLon: s.lon, agencyId, ownerManagerId: manager.id, businessType: s.biz, businessContactName: s.contact, businessContactPhone: s.phone, isActive: true, basePointConfirmed: true },
      create: { placeId: s.placeId, companyName: s.companyName, address: s.address, gpsLat: s.lat, gpsLon: s.lon, agencyId, ownerManagerId: manager.id, businessType: s.biz, businessContactName: s.contact, businessContactPhone: s.phone, basePointConfirmed: true },
    });
    siteIds.push(site.id);
    console.log(`  현장 ✓ ${s.companyName}`);
  }

  // 2) 직무지도원 + 배정
  const hash = await bcrypt.hash(WORKER_PW, 12);
  for (const w of WORKERS) {
    const worker = await prisma.worker.upsert({
      where: { loginId: w.loginId },
      update: { workerName: w.name, phoneNumber: w.phone, status: "ACTIVE", openToOffers: false },
      create: { loginId: w.loginId, password: hash, workerName: w.name, phoneNumber: w.phone, status: "ACTIVE", openToOffers: false },
    });
    e2eWorkerIds.push(worker.id);
    await prisma.siteAssignment.deleteMany({ where: { workerId: worker.id } });
    await prisma.siteAssignment.create({
      data: {
        workerId: worker.id, siteId: siteIds[w.site], agencyId, assignedByManagerId: manager.id,
        status: "ACTIVE", serviceStep: w.step as any, workType: w.workType,
        commuteGuidanceIncluded: w.workType !== "FULL_DAY",
      },
    });
    console.log(`  직무지도원 ✓ ${w.name} (${w.loginId}/${w.phone}) → ${SITES[w.site].companyName} [${w.workType}/${w.step}]`);
  }

  // 3) 훈련생
  await prisma.trainee.deleteMany({ where: { note: "[E2E]" } });
  for (const t of TRAINEES) {
    await prisma.trainee.create({
      data: { name: t.name, gender: t.gender, disabilityType: t.disabilityType, severity: t.severity, currentSiteId: siteIds[t.site], status: "TRAINING", note: "[E2E]" },
    });
    console.log(`  훈련생 ✓ ${t.name} → ${SITES[t.site].companyName}`);
  }

  console.log("\n========== E2E 테스트 계정 ==========");
  console.log("운영자:   admin / admin1234!");
  console.log("관리자:   manager01 / manager1234!   (에이전시 다음미래)");
  console.log(`직무지도원: 전화번호 로그인, 비번 = ${WORKER_PW}`);
  for (const w of WORKERS) console.log(`   ${w.phone}  (${w.name})`);
  console.log("=====================================");
  console.log("\n현장 3 · 직무지도원 5(배정) · 훈련생 5 연결 완료. (제거: --clean)");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
