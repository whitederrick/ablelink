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

// 목록 조회 확인용 데모 데이터: 각 20개(현장/직무지도원/훈련생). 마커(e2e-, [E2E])는 유지해 --clean·rich 호환.
const N = 20;
const SITE_BIZ = ["제조", "서비스", "유통", "요식", "물류", "돌봄", "제과", "세탁", "원예", "사무"];
const SITES = Array.from({ length: N }, (_, i) => {
  const n = i + 1;
  return {
    placeId: `e2e-site-${n}`,
    companyName: `[E2E] 데모현장${String(n).padStart(2, "0")}`,
    address: `서울특별시 데모구 데모로 ${n}`,
    lat: 37.49 + (i % 10) * 0.006,
    lon: 126.98 + Math.floor(i / 10) * 0.012,
    biz: SITE_BIZ[i % SITE_BIZ.length],
    contact: `담당자${n}`,
    phone: `02${String(12340000 + n).padStart(8, "0")}`,
  };
});

const WORKER_NAMES = ["강도윤", "윤서아", "임하준", "한지우", "오시우", "서지호", "문하은", "조은우", "배수린", "신유찬", "권나윤", "홍지안", "유준서", "장서연", "노하린", "곽도현", "천예준", "민서윤", "구하늘", "범지후"];
const WTYPES = ["FULL_DAY", "AM", "PM"];
const STEPS = ["FIELD_TRAINING", "ADAPTATION"];
const WORKERS = Array.from({ length: N }, (_, i) => {
  const n = i + 1;
  return {
    loginId: `e2e-worker-${n}`,
    name: WORKER_NAMES[i % WORKER_NAMES.length],
    phone: `010${String(20000000 + n).padStart(8, "0")}`,
    site: i % N,                              // 워커 1명당 현장 1개
    workType: WTYPES[i % WTYPES.length],
    step: STEPS[i % STEPS.length],
  };
});

const TRAINEE_NAMES = ["정해성", "문가은", "신유찬", "배수린", "조은우", "김도하", "이서진", "박지율", "최예나", "정시윤", "강하람", "윤도경", "임채원", "한별", "오주아", "서담", "문지효", "조하준", "배은교", "신아라"];
const DTYPES = ["지적장애", "자폐성장애", "발달장애", "지체장애", "청각장애"];
const TRAINEES = Array.from({ length: N }, (_, i) => ({
  name: TRAINEE_NAMES[i % TRAINEE_NAMES.length],
  gender: i % 2 === 0 ? "M" : "F",
  disabilityType: DTYPES[i % DTYPES.length],
  severity: i % 2 === 0 ? "심한" : "심하지않은",
  site: i % N,                                // 현장당 훈련생 1명(5명/현장 제한 내)
}));

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
  console.log(`\n현장 ${SITES.length} · 직무지도원 ${WORKERS.length}(배정) · 훈련생 ${TRAINEES.length} 연결 완료. (제거: --clean)`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
