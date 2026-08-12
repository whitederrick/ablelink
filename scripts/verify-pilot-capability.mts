// scripts/verify-pilot-capability.mts
// 파일럿 문서 외부 유출 차단 판정 검증 — v1.8 §3.2·§8, §12 6단계.
// 실행: npx tsx scripts/verify-pilot-capability.mts
//
// ★★1번 주장은 "파일럿이 잘 된다"가 아니라 **"기존 서비스가 안 흔들린다"**이다.
//   (사용자 지시 2026-08-12: 파일럿 때문에 기존 운영 코드를 건드리면 안 된다.)
//
//   ① 권한은 기존 경로 그대로 — 파일럿 참여자는 `worker.planType`(운영자 개인 부여)로 통과한다.
//      planGuard.ts를 한 줄도 고치지 않았고, 문서·서명 라우트도 손대지 않았다.
//      이 스크립트는 그 경로가 실제로 성립하는지(STANDARD면 PDF_GENERATE 허용) 확인한다.
//   ② 차단 판정은 비파일럿에 대해 항상 false/0 — 기존 흐름에 아무 판단도 더하지 않는다.
//
// ⚠️ 파괴적 — assertWritableDb()로 운영 DB를 차단한다.
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}
import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";
import { CleanupGuard } from "./_cleanupGuard.mts";
import * as capNs from "../lib/pilot/capability";
import * as planNs from "../lib/planGuard";

function interop<T>(ns: unknown): T {
  return (ns as { default?: T }).default ?? (ns as T);
}
const { getPilotAssignmentState, countPilotRuns } =
  interop<typeof import("../lib/pilot/capability")>(capNs);
const { checkPlanAccess } = interop<typeof import("../lib/planGuard")>(planNs);

const prisma = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`, detail !== undefined ? JSON.stringify(detail, bigintSafe) : ""); }
}
function bigintSafe(_k: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v; }

async function main() {
  await assertWritableDb();
  const stamp = Date.now();

  const activeOther = await prisma.pilotSession.count({ where: { status: "ACTIVE" } });
  if (activeOther > 0) {
    console.log(`\n⛔ 이미 ACTIVE인 파일럿 회차가 ${activeOther}건 있습니다. 종료 후 다시 실행하세요.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // 파일럿 기관은 FREE로 둔다 — 기관 구독 없이도 파일럿이 돌아야 한다는 것이 요점이다.
  const freeAgency = await prisma.agency.create({ data: { name: `__cap_free_${stamp}`, planType: "FREE" } });
  const proAgency  = await prisma.agency.create({ data: { name: `__cap_pro_${stamp}`,  planType: "PRO" } });
  const admin = await prisma.admin.create({
    data: { loginId: `__cap_adm_${stamp}`, passwordHash: "x", displayName: "운영자" },
  });
  // ★Manager를 1명 둔다 — Manager가 0명인 기관은 planGuard가 "셀프등록(무소속 운영)"으로 보고
  //  PDF·서명을 무료 허용한다. 그 경로로 새면 FREE 기관 판정이 위양성으로 통과한다.
  for (const ag of [freeAgency, proAgency]) {
    await prisma.manager.create({
      data: { agencyId: ag.id, loginId: `__cap_mgr_${ag.id}_${stamp}`, passwordHash: "x", displayName: "담당자" },
    });
  }

  const freeSite = await prisma.site.create({
    data: { companyName: "__cap_site_free", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: freeAgency.id },
  });
  const proSite = await prisma.site.create({
    data: { companyName: "__cap_site_pro", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: proAgency.id },
  });

  const mkWorker = (tag: string, planType: "FREE" | "STANDARD") => prisma.worker.create({
    data: {
      loginId: `__cap_${tag}_${stamp}`, password: "x", workerName: `지도원${tag}`,
      phoneNumber: `0112${String(stamp).slice(-6)}${tag.length}`, role: "WORKER", status: "ACTIVE",
      planType,
    },
  });

  const wNormal = await mkWorker("n",  "FREE");      // 비파일럿 · FREE 기관
  const wPro    = await mkWorker("pr", "FREE");      // 비파일럿 · PRO 기관
  const wPilot  = await mkWorker("p",  "STANDARD");  // 파일럿 참여자(운영자 개인 부여)

  const sessionIds: bigint[] = [];
  const c = new CleanupGuard();

  try {
    const session = await prisma.pilotSession.create({
      data: {
        agencyId: freeAgency.id, startDate: D("2026-08-01"), endDate: D("2026-08-31"),
        createdByAdminId: admin.id, status: "ACTIVE", activatedAt: new Date(),
      },
    });
    sessionIds.push(session.id);

    const mkAssignment = (workerId: bigint, siteId: bigint, agencyId: bigint, pilotSessionId: bigint | null) =>
      prisma.siteAssignment.create({
        data: {
          workerId, siteId, agencyId, pilotSessionId, status: "ACTIVE", workType: "FULL_DAY",
          startDate: D("2026-08-01"), endDate: D("2026-08-31"),
        },
      });

    const aNormal = await mkAssignment(wNormal.id, freeSite.id, freeAgency.id, null);
    const aPro    = await mkAssignment(wPro.id,    proSite.id,  proAgency.id,  null);
    const aPilot  = await mkAssignment(wPilot.id,  freeSite.id, freeAgency.id, session.id);

    // ── ① 권한은 기존 경로 그대로 ────────────────────────────────
    console.log("\n[①] 기능 권한 — 기존 planGuard 경로만으로 성립(코드 변경 0)");
    const pilotPlan = await checkPlanAccess(wPilot.id, "PDF_GENERATE");
    check("★파일럿 참여자(planType=STANDARD)는 FREE 기관에서도 PDF 생성 허용",
      pilotPlan.allowed === true && pilotPlan.planType === "STANDARD", pilotPlan);
    check("★파일럿 참여자도 PRO 전용 기능은 여전히 거부(등급이 그대로 작동)",
      (await checkPlanAccess(wPilot.id, "PAYROLL")).allowed === false);
    check("파일럿 참여자 서명 기능 허용", (await checkPlanAccess(wPilot.id, "PDF_SIGN")).allowed === true);
    check("파일럿 참여자 사업체 대면서명 허용", (await checkPlanAccess(wPilot.id, "SITE_MANAGER_SIGN")).allowed === true);

    console.log("\n[①-b] 기존 사용자 판정 무변경");
    check("FREE 기관 · planType FREE 워커 → 기존대로 거부",
      (await checkPlanAccess(wNormal.id, "PDF_GENERATE")).allowed === false);
    check("PRO 기관 · planType FREE 워커 → 기존대로 허용",
      (await checkPlanAccess(wPro.id, "PDF_GENERATE")).allowed === true);

    // ── ② 차단 판정 — 비파일럿에는 아무 판단도 더하지 않는다 ────
    console.log("\n[②] getPilotAssignmentState — 비파일럿은 항상 false");
    check("비파일럿(FREE 기관) → isPilot=false", (await getPilotAssignmentState(aNormal.id)).isPilot === false);
    check("비파일럿(PRO 기관) → isPilot=false",  (await getPilotAssignmentState(aPro.id)).isPilot === false);
    const stPilot = await getPilotAssignmentState(aPilot.id);
    check("파일럿 배정 → isPilot=true, sessionActive=true",
      stPilot.isPilot === true && stPilot.sessionActive === true, stPilot);

    // ★회차가 끝나도 '파일럿 소속'은 유지돼야 한다 — 아니면 종료 후 제출이 열린다.
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ENDED" } });
    const stEnded = await getPilotAssignmentState(aPilot.id);
    check("★회차 ENDED여도 isPilot=true(종료 후 제출이 열리면 안 된다)",
      stEnded.isPilot === true && stEnded.sessionActive === false, stEnded);
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ACTIVE" } });

    const missing = await getPilotAssignmentState(BigInt("9999999999"));
    check("없는 배정 → isPilot=false(기존 흐름 방해 없음)", missing.isPilot === false);

    // ── ③ countPilotRuns ────────────────────────────────────────
    console.log("\n[③] countPilotRuns — 외부 전송 차단 판정");
    check("빈 목록 → 0", (await countPilotRuns([])) === 0);

    const mkRun = (asgId: bigint, siteId: bigint, workerId: bigint, agencyId: bigint) =>
      prisma.documentRun.create({
        data: {
          agencyId, assignmentId: asgId, siteId, workerId,
          docType: "ATTENDANCE_SHEET", periodStart: D("2026-08-01"), periodEnd: D("2026-08-31"),
          openAt: new Date(), dueAt: D("2026-08-31"),
        },
      });
    const runNormal = await mkRun(aPro.id,   proSite.id,  wPro.id,   proAgency.id);
    const runPilot  = await mkRun(aPilot.id, freeSite.id, wPilot.id, freeAgency.id);

    check("★비파일럿 run만 → 0(기존 공단 발송은 그대로 나간다)", (await countPilotRuns([runNormal.id])) === 0);
    check("파일럿 run → 1(발송 차단)", (await countPilotRuns([runPilot.id])) === 1);
    check("★섞이면 파일럿 건수를 센다 — 묶음 전체가 막힌다",
      (await countPilotRuns([runNormal.id, runPilot.id])) === 1);

    await prisma.documentRun.deleteMany({ where: { id: { in: [runNormal.id, runPilot.id] } } });

  } finally {
    console.log("\n[정리]");
    // ★SiteAssignment→Worker 관계명은 `worker`가 아니라 `user`다. 이름 패턴 대신 기관 id로 지운다.
    await c.step("documentRun", () => prisma.documentRun.deleteMany({
      where: { agencyId: { in: [freeAgency.id, proAgency.id] } },
    }));
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({
      where: { agencyId: { in: [freeAgency.id, proAgency.id] } },
    }));
    for (const sid of sessionIds) {
      await c.step(`pilotSession#${sid}`, () => prisma.pilotSession.delete({ where: { id: sid } }));
    }
    await c.step("workers", () => prisma.worker.deleteMany({
      where: { id: { in: [wNormal.id, wPro.id, wPilot.id] } },
    }));
    await c.step("sites", () => prisma.site.deleteMany({ where: { id: { in: [freeSite.id, proSite.id] } } }));
    await c.step("managers", () => prisma.manager.deleteMany({ where: { agencyId: { in: [freeAgency.id, proAgency.id] } } }));
    await c.step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await c.step("agencies", () => prisma.agency.deleteMany({ where: { id: { in: [freeAgency.id, proAgency.id] } } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__cap_"]);
  }

  console.log(`\n=== 결과: ${pass} passed, ${fail} failed ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
