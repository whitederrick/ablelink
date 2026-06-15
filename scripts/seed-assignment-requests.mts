// 배정 요청/확정 검증용 시드. manager01 위탁기관에 전용 데모 현장 + 후보 배정을 생성.
//   npx tsx scripts/seed-assignment-requests.mts          → 시드(기존 시드 정리 후 재생성)
//   npx tsx scripts/seed-assignment-requests.mts --clean   → 시드 데이터(현장·후보·요청) 삭제
// e2e ACTIVE 배정이 정원을 깎지 않도록, 활성 워커가 없는 전용 현장(placeId req-site-*)과
// 전용 후보 워커(loginId req-cand-*)를 만들어 격리한다.
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");
const day = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const manager = await prisma.manager.findFirst({ where: { loginId: "manager01" }, select: { id: true, agencyId: true } });
if (!manager) { console.error("manager01 없음 — prisma/seed.ts 먼저 실행"); await prisma.$disconnect(); process.exit(1); }
const AG = manager.agencyId, MGR = manager.id;

// 전용 데모 현장(정원 포함). cap: 근무형태별 모집 인원.
const SITES = [
  { key: "req-site-1", name: "[배정요청] 데모현장 A", cap: { am: 0, pm: 2, full: 0 } },
  { key: "req-site-2", name: "[배정요청] 데모현장 B", cap: { am: 1, pm: 0, full: 0 } },
  { key: "req-site-3", name: "[배정요청] 데모현장 C", cap: { am: 1, pm: 1, full: 0 } },
  { key: "req-site-4", name: "[배정요청] 데모현장 D", cap: { am: 1, pm: 1, full: 0 } },
  { key: "req-site-5", name: "[배정요청] 데모현장 E", cap: { am: 1, pm: 0, full: 0 } },
  { key: "req-site-6", name: "[배정요청] 데모현장 F", cap: { am: 0, pm: 0, full: 2 } },
  { key: "req-site-7", name: "[배정요청] 데모현장 G", cap: { am: 0, pm: 0, full: 1 } },
  { key: "req-site-8", name: "[배정요청] 데모현장 H", cap: { am: 1, pm: 0, full: 0 } },
];

const CAND_NAMES = ["남도진","서아린","유시현","한도윤","오세빈","문지환","조하영","배준호","신가람","권태오","홍서우","유라온","장하민","노을찬","천보경","민서후"];
type St = "REQUESTED" | "ACCEPTED" | "REJECTED" | "DROPPED" | "EXPIRED";
// site = SITES 인덱스, c = 후보 인덱스(0~), wt = 요청/선택 근무형태 CSV, dl = 회신기한(일)
const PLAN: { site: number; c: number; status: St; wt: string; dl: number }[] = [
  { site: 0, c: 0,  status: "REQUESTED", wt: "PM", dl: 1 },
  { site: 0, c: 1,  status: "REQUESTED", wt: "PM", dl: 1 },
  { site: 0, c: 2,  status: "REQUESTED", wt: "PM", dl: 1 },
  { site: 1, c: 3,  status: "REQUESTED", wt: "AM", dl: 2 },
  { site: 1, c: 4,  status: "REQUESTED", wt: "AM", dl: 2 },
  { site: 1, c: 5,  status: "ACCEPTED",  wt: "AM", dl: 2 },
  { site: 2, c: 6,  status: "ACCEPTED",  wt: "AM", dl: 3 },
  { site: 2, c: 7,  status: "REJECTED",  wt: "AM,PM", dl: 3 },
  { site: 3, c: 8,  status: "REQUESTED", wt: "AM,PM", dl: 4 },
  { site: 3, c: 9,  status: "REQUESTED", wt: "AM", dl: 4 },
  { site: 4, c: 10, status: "REQUESTED", wt: "AM", dl: 5 },
  { site: 5, c: 11, status: "ACCEPTED",  wt: "FULL_DAY", dl: 6 },
  { site: 5, c: 12, status: "ACCEPTED",  wt: "FULL_DAY", dl: 6 },
  { site: 5, c: 13, status: "DROPPED",   wt: "FULL_DAY", dl: 6 }, // 상태 변경(되돌리기) 테스트
  { site: 6, c: 14, status: "REQUESTED", wt: "FULL_DAY", dl: 7 },
  { site: 7, c: 15, status: "REQUESTED", wt: "AM", dl: -1 },      // 기한 초과 → EXPIRED(상태 변경 테스트)
];

// 정리: 기존 req-* 요청·후보·현장
// ① req-site 현장에 달린 모든 배정 제거(화면 액션으로 다른 워커가 만든 stray 배정까지 포함)
const reqSites0 = await prisma.site.findMany({ where: { placeId: { startsWith: "req-site-" } }, select: { id: true } });
if (reqSites0.length) await prisma.siteAssignment.deleteMany({ where: { siteId: { in: reqSites0.map(s => s.id) } } });
// ② req-cand 후보 워커가 (다른 현장에) 만든 배정도 제거
const candWorkers = await prisma.worker.findMany({ where: { loginId: { startsWith: "req-cand-" } }, select: { id: true } });
if (candWorkers.length) await prisma.siteAssignment.deleteMany({ where: { workerId: { in: candWorkers.map(w => w.id) } } });
if (CLEAN) {
  await prisma.worker.deleteMany({ where: { loginId: { startsWith: "req-cand-" } } });
  await prisma.site.deleteMany({ where: { placeId: { startsWith: "req-site-" } } });
  console.log("배정요청 시드(현장·후보·요청) 삭제 완료.");
  await prisma.$disconnect();
  process.exit(0);
}

// 1) 현장(정원 설정)
const siteIds: bigint[] = [];
for (let i = 0; i < SITES.length; i++) {
  const s = SITES[i];
  const site = await prisma.site.upsert({
    where: { placeId: s.key },
    update: { companyName: s.name, agencyId: AG, ownerManagerId: MGR, amCapacity: s.cap.am, pmCapacity: s.cap.pm, fullDayCapacity: s.cap.full, isActive: true, basePointConfirmed: true },
    create: { placeId: s.key, companyName: s.name, address: `서울특별시 데모구 요청로 ${i + 1}`, gpsLat: 37.5 + i * 0.004, gpsLon: 126.97 + i * 0.004, agencyId: AG, ownerManagerId: MGR, amCapacity: s.cap.am, pmCapacity: s.cap.pm, fullDayCapacity: s.cap.full, basePointConfirmed: true },
  });
  siteIds.push(site.id);
}
console.log(`현장 ${SITES.length}개(정원 포함) 준비`);

// 2) 후보 워커
const hash = await bcrypt.hash("e2e1234!", 12);
const candIds: bigint[] = [];
for (let i = 0; i < CAND_NAMES.length; i++) {
  const loginId = `req-cand-${i + 1}`;
  const w = await prisma.worker.upsert({
    where: { loginId },
    update: { workerName: CAND_NAMES[i], status: "ACTIVE" },
    create: { loginId, password: hash, workerName: CAND_NAMES[i], phoneNumber: `010${String(40000000 + i + 1).padStart(8, "0")}`, status: "ACTIVE", openToOffers: true },
  });
  candIds.push(w.id);
}
console.log(`후보 워커 ${CAND_NAMES.length}명 준비`);

// 3) 요청/후보 배정 생성
let created = 0;
for (const p of PLAN) {
  const accepted = p.status === "ACCEPTED";
  const closed = p.status === "REJECTED" || p.status === "DROPPED" || p.status === "EXPIRED";
  const wt0 = p.wt.split(",")[0];
  await prisma.siteAssignment.create({
    data: {
      siteId: siteIds[p.site], workerId: candIds[p.c], agencyId: AG,
      status: p.status,
      requestedWorkTypes: p.wt,
      replyDeadline: day(p.dl),
      // ACCEPTED·DROPPED(수락 후 탈락)는 선택 근무형태 보존 → 되돌리기 시 ACCEPTED 복원
      workType: accepted || p.status === "DROPPED" ? wt0 : null,
      commuteGuidanceIncluded: accepted ? wt0 !== "FULL_DAY" : true,
      connectedAt: accepted ? new Date() : null,
      assignedByManagerId: MGR,
      rejectedAt: closed ? new Date() : null,
      statusReason: p.status === "REJECTED" ? "후보 거절" : p.status === "DROPPED" ? "담당자 탈락" : p.status === "EXPIRED" ? "회신 기한 초과" : "[SEED] 배정요청 검증",
    },
  });
  created++;
}
console.log(`요청/후보 배정 ${created}건 생성 — 배정 확정 화면(/manager/assignment-selection)에서 확인`);
await prisma.$disconnect();
