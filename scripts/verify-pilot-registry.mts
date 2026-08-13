// scripts/verify-pilot-registry.mts
// 3단계 검증 — 파일럿 전용 자원 생성과 레지스트리 기록의 원자성.
//
// ★핵심 단언: **생성한 자원 수 == pilot_resources 의 kind별 건수.**
//  기록이 누락된 자원은 초기화가 영영 못 찾는다(Worker·Trainee 에 agencyId 가 없어
//  레지스트리가 유일한 판별 수단이다). 코드 검토로 갈음하지 않고 DB 조회로 확인한다.
//
// 실행: npx tsx scripts/verify-pilot-registry.mts

import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";
import { CleanupGuard } from "./_cleanupGuard.mts";

// ★.mts(ESM) → lib/*.ts(CJS) 인터롭: tsx 환경에서 named export 가 감지되지 않아
//  (`Object.keys(ns)` = ['default']) 이름 import 가 런타임에 실패한다. 리포 전역 조건이다.
import * as resNs from "../lib/pilot/resources";
type ResModule = typeof import("../lib/pilot/resources");
const R = (resNs as unknown as { default?: ResModule }).default ?? (resNs as unknown as ResModule);

assertWritableDb("파일럿 레지스트리 검증(테스트 자원 생성·삭제)");

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const STAMP = Date.now().toString(36);
const created = { pilotId: null as bigint | null, agencyId: null as bigint | null };

async function main() {
  console.log("\n[1] 파일럿 + 전용 Agency 생성");
  const p = await R.createPilot({ name: `검증파일럿-${STAMP}`, agencyName: `검증기관-${STAMP}`, note: "verify" });
  created.pilotId = p.pilotId; created.agencyId = p.agencyId;
  ok("파일럿 생성", p.pilotId > BigInt(0));
  const ag = await prisma.agency.findUnique({ where: { id: p.agencyId }, select: { planType: true } });
  ok("전용 기관 planType=STANDARD (급여는 PRO라 차단)", ag?.planType === "STANDARD", String(ag?.planType));
  ok("AGENCY 레지스트리 기록", (await cnt("AGENCY")) === 1);

  console.log("\n[2] 사업체 2곳");
  const s1 = await R.createPilotSite(p.pilotId, {
    companyName: `검증사업체A-${STAMP}`, address: "서울 중구 세종대로 110", detailAddress: "1층",
    gpsLat: "37.5663", gpsLon: "126.9779", businessContactName: "김담당", businessContactPhone: "01012345678",
  });
  const s2 = await R.createPilotSite(p.pilotId, {
    companyName: `검증사업체B-${STAMP}`, address: "서울 종로구 종로 1", gpsLat: "37.5700", gpsLon: "126.9820",
    businessContactName: "이담당",
  });
  ok("사업체 2건 생성", !!s1.id && !!s2.id);
  ok("SITE 레지스트리 = 2", (await cnt("SITE")) === 2);
  const s1row = await prisma.site.findUnique({ where: { id: s1.id }, select: { gpsLat: true, gpsLon: true, businessContactName: true, businessContactEmail: true, isVerified: true } });
  ok("좌표가 저장됨(non-null)", s1row != null && Number(s1row.gpsLat) !== 0 && Number(s1row.gpsLon) !== 0);
  ok("사업체 담당자명이 Site.businessContactName 에 저장", s1row?.businessContactName === "김담당");
  ok("★이메일은 저장하지 않음", s1row?.businessContactEmail == null);
  ok("isVerified=false", s1row?.isVerified === false);

  console.log("\n[3] 좌표 없는 사업체는 거부 (Site.gpsLat/gpsLon non-null)");
  const before = await cnt("SITE");
  await expectFail("좌표 누락 거부", () => R.createPilotSite(p.pilotId!, {
    companyName: "무좌표", address: "어딘가", gpsLat: "", gpsLon: "", businessContactName: "홍길동",
  }));
  ok("거부가 말뿐이 아님 — SITE 레지스트리 불변", (await cnt("SITE")) === before);

  console.log("\n[4] 훈련생 2명 + 재적 (같은 현장 → 1:多 판정 대상)");
  await R.createPilotTrainee(p.pilotId, { siteId: s1.id.toString(), name: "훈련생1", gender: "남", disabilityType: "지적장애", severity: "중증", startDate: "2026-08-01" });
  await R.createPilotTrainee(p.pilotId, { siteId: s1.id.toString(), name: "훈련생2", gender: "여", disabilityType: "자폐성장애", severity: "경증", startDate: "2026-08-01", endDate: "2026-08-31" });
  ok("TRAINEE 레지스트리 = 2", (await cnt("TRAINEE")) === 2);
  ok("PLACEMENT 레지스트리 = 2 (훈련생과 같은 트랜잭션)", (await cnt("PLACEMENT")) === 2);

  console.log("\n[5] 타 파일럿·비파일럿 자원 차단");
  const foreign = await prisma.site.findFirst({ where: { id: { notIn: [s1.id, s2.id] } }, select: { id: true } });
  if (foreign) {
    await expectFail("레지스트리 미등록 사업체로 훈련생 등록 거부", () => R.createPilotTrainee(p.pilotId!, {
      siteId: foreign.id.toString(), name: "침입", gender: "남", disabilityType: "x", severity: "중증", startDate: "2026-08-01",
    }));
  } else { console.log("  (비교할 비파일럿 사업체가 없어 건너뜀)"); }

  console.log("\n[6] 직무지도원 계정");
  const phone = `010${String(Date.now()).slice(-8)}`;
  const w = await R.createPilotWorker(p.pilotId, { workerName: "검증지도원", phoneNumber: phone, password: "pilot1234!" });
  ok("WORKER 레지스트리 = 1", (await cnt("WORKER")) === 1);
  const wrow = await prisma.worker.findUnique({ where: { id: w.id }, select: { loginId: true, planType: true, password: true, isTemporary: true, hasKnownPassword: true } });
  ok("loginId = 휴대전화번호", wrow?.loginId === phone);
  ok("planType=STANDARD", wrow?.planType === "STANDARD");
  ok("★평문 비밀번호 미저장(bcrypt 해시)", !!wrow && wrow.password !== "pilot1234!" && wrow.password.startsWith("$2"));
  // ★기본값이 false라 생략하면 임시 비밀번호가 그대로 영구 비밀번호가 되고 최초 온보딩을 건너뛴다.
  //  로그인 토큰이 이 값을 클레임으로 실어 서버 컴포넌트가 /worker/onboarding으로 보낸다.
  ok("★isTemporary=true (최초 로그인 시 비밀번호 변경 강제)", wrow?.isTemporary === true, String(wrow?.isTemporary));
  ok("hasKnownPassword=true (스키마 기본값)", wrow?.hasKnownPassword === true);
  await expectFail("중복 전화번호 거부 (기존 계정 재사용 금지)", () =>
    R.createPilotWorker(p.pilotId!, { workerName: "중복", phoneNumber: phone, password: "pilot1234!" }));
  ok("거부 후에도 WORKER 레지스트리 = 1", (await cnt("WORKER")) === 1);

  console.log("\n[6-1] 전화번호 중복 사전확인 (§8-3 — 409를 만나기 전에 알린다)");
  const freePhone = `010${String(Date.now() + 1).slice(-8)}`;
  ok("미가입 번호 → available=true", (await R.checkPilotWorkerPhone(freePhone)).available === true);
  ok("가입된 번호 → available=false", (await R.checkPilotWorkerPhone(phone)).available === false);
  await expectFail("형식 오류 번호 거부", () => R.checkPilotWorkerPhone("123"));

  console.log("\n[7] 배정 — 출퇴근 면제 + 근무형태");
  const a = await R.createPilotAssignment(p.pilotId, {
    workerId: w.id.toString(), siteId: s1.id.toString(), workType: "FULL_DAY",
    startDate: "2026-08-03", endDate: "2026-08-28",
  });
  ok("ASSIGNMENT 레지스트리 = 1", (await cnt("ASSIGNMENT")) === 1);
  const arow = await prisma.siteAssignment.findUnique({ where: { id: a.id }, select: { attendanceButtonExempt: true, workType: true, agencyId: true, commuteGuidanceIncluded: true } });
  ok("★attendanceButtonExempt = true (출퇴근 버튼 없이 일괄 작성)", arow?.attendanceButtonExempt === true);
  ok("agencyId = 전용 기관 (급여 스코프 격리)", arow?.agencyId === p.agencyId);
  ok("FULL_DAY 는 출퇴근지도 미포함", arow?.commuteGuidanceIncluded === false);
  await expectFail("CUSTOM 근무형태 거부 (시각 없으면 09:00~18:00로 조용히 대체됨)", () =>
    R.createPilotAssignment(p.pilotId!, { workerId: w.id.toString(), siteId: s1.id.toString(), workType: "CUSTOM", startDate: "2026-08-03", endDate: "2026-08-28" }));

  console.log("\n[8] ★★기록 누락 0 — 생성 자원 수 == 레지스트리 kind별 건수");
  const expected: Record<string, number> = { AGENCY: 1, SITE: 2, TRAINEE: 2, PLACEMENT: 2, WORKER: 1, ASSIGNMENT: 1 };
  const actual = await countsByKind(p.pilotId);
  for (const [k, v] of Object.entries(expected)) {
    ok(`${k.padEnd(11)} 기대 ${v} = 실제 ${actual[k] ?? 0}`, (actual[k] ?? 0) === v, JSON.stringify(actual));
  }
  // 실제 DB 행 수와도 대조 — 레지스트리가 "있다고만" 하고 실물이 없으면 안 된다.
  const realCounts = {
    AGENCY: await prisma.agency.count({ where: { id: p.agencyId } }),
    SITE: await prisma.site.count({ where: { agencyId: p.agencyId } }),
    WORKER: await prisma.worker.count({ where: { id: { in: await ids("WORKER", p.pilotId) } } }),
    ASSIGNMENT: await prisma.siteAssignment.count({ where: { agencyId: p.agencyId } }),
    TRAINEE: await prisma.trainee.count({ where: { id: { in: await ids("TRAINEE", p.pilotId) } } }),
    PLACEMENT: await prisma.traineePlacement.count({ where: { id: { in: await ids("PLACEMENT", p.pilotId) } } }),
  };
  for (const [k, v] of Object.entries(realCounts)) {
    ok(`${k.padEnd(11)} 실물 DB 행 ${v} = 레지스트리 ${actual[k] ?? 0}`, v === (actual[k] ?? 0));
  }

  console.log("\n[9] 상세 조회가 레지스트리 기준인지");
  const detail = await R.getPilotDetail(p.pilotId);
  ok("상세 sites = 2", detail.sites.length === 2);
  ok("상세 trainees = 2", detail.trainees.length === 2);
  ok("상세 workers = 1", detail.workers.length === 1);
  ok("상세 assignments = 1", detail.assignments.length === 1);
  ok("registry.counts 일치", detail.registry.counts.SITE === 2 && detail.registry.counts.ASSIGNMENT === 1);
}

async function cnt(kind: string): Promise<number> {
  if (!created.pilotId) return -1;
  return prisma.pilotResource.count({ where: { pilotId: created.pilotId, kind: kind as never } });
}
async function countsByKind(pilotId: bigint): Promise<Record<string, number>> {
  const rows = await prisma.pilotResource.groupBy({ by: ["kind"], where: { pilotId }, _count: { _all: true } });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.kind] = r._count._all;
  return out;
}
async function ids(kind: string, pilotId: bigint): Promise<bigint[]> {
  const rows = await prisma.pilotResource.findMany({ where: { pilotId, kind: kind as never }, select: { resourceKey: true } });
  return rows.map((r) => BigInt(r.resourceKey));
}
async function expectFail(label: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(label, false, "거부되지 않음"); }
  catch { ok(label, true); }
}

// ★정리는 성공 경로에서만 도는 코드가 아니어야 한다 — finally 에서 null-safe 로 돈다.
async function cleanup() {
  console.log("\n[정리]");
  const c = new CleanupGuard();
  if (!created.pilotId) { console.log("  (생성된 것 없음)"); return; }
  const pid = created.pilotId;
  const asgIds = await ids("ASSIGNMENT", pid), plIds = await ids("PLACEMENT", pid);
  const trIds = await ids("TRAINEE", pid), wkIds = await ids("WORKER", pid), stIds = await ids("SITE", pid);
  await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { id: { in: asgIds } } }));
  await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { id: { in: plIds } } }));
  await c.step("trainee", () => prisma.trainee.deleteMany({ where: { id: { in: trIds } } }));
  await c.step("worker", () => prisma.worker.deleteMany({ where: { id: { in: wkIds } } }));
  await c.step("site", () => prisma.site.deleteMany({ where: { id: { in: stIds } } }));
  if (created.agencyId) await c.step("agency", () => prisma.agency.deleteMany({ where: { id: created.agencyId! } }));

  // ★감사·접속 기록은 FK가 없어 Cascade로 안 지워진다(F21). summary·actorLabel에 기관명·사업체명이
  //  스냅샷으로 박히므로 검증 흔적도 반드시 명시 삭제한다. 5단계 초기화도 같은 축을 처리해야 한다.
  const auditIdSets: { entityType: string; ids: string[] }[] = [
    { entityType: "Pilot", ids: [pid.toString()] },
    { entityType: "Site", ids: stIds.map(String) },
    { entityType: "Trainee", ids: trIds.map(String) },
    { entityType: "Worker", ids: wkIds.map(String) },
    { entityType: "SiteAssignment", ids: asgIds.map(String) },
  ];
  for (const { entityType, ids: eids } of auditIdSets) {
    if (eids.length === 0) continue;
    await c.step(`audit:${entityType}`, () => prisma.auditEvent.deleteMany({ where: { entityType, entityId: { in: eids } } }));
  }
  if (created.agencyId) {
    await c.step("audit:agency-scope", () => prisma.auditEvent.deleteMany({ where: { agencyId: created.agencyId! } }));
    await c.step("accesslog:agency-scope", () => prisma.accessLog.deleteMany({ where: { agencyId: created.agencyId! } }));
  }

  await c.step("pilot", () => prisma.pilot.delete({ where: { id: pid } })); // PilotResource 는 Cascade
  const left = c.report();
  ok("테스트 데이터 정리 완료(잔여 0)", left === 0, `정리 실패 ${left}건`);

  // 잔여를 조회로 재확인한다 — "정리 완료" 출력만 믿지 않는다.
  const leftovers = {
    pilots: await prisma.pilot.count({ where: { id: pid } }),
    resources: await prisma.pilotResource.count({ where: { pilotId: pid } }),
    agency: created.agencyId ? await prisma.agency.count({ where: { id: created.agencyId } }) : 0,
    audit: await prisma.auditEvent.count({ where: { OR: auditIdSets.map((s) => ({ entityType: s.entityType, entityId: { in: s.ids } })) } }),
  };
  ok(`잔여 재조회 0 (${JSON.stringify(leftovers)})`, Object.values(leftovers).every((v) => v === 0));
}

main()
  .catch((e) => { fail++; console.error("\n⛔ 예외:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("정리 중 예외:", e));
    console.log(`\n=== 결과: ${pass} passed, ${fail} failed ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
