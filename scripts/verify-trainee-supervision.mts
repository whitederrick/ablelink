// scripts/verify-trainee-supervision.mts
// 담당 관계(TraineeSupervision) 트랜잭션 서비스 통합 검증 — D-1 1단계.
// 실행: npx tsx scripts/verify-trainee-supervision.mts
//
// 순수 함수 테스트(__tests__/lib.traineeSupervision.test.ts)는 판정 로직만 검증한다.
// 이 스크립트는 실제 DB 트랜잭션에서 락 → 재조회 → 검증 → 생성이 동작하는지,
// 그리고 동시 요청에서 불변식이 실제로 강제되는지를 확인한다.
//
// ⚠️ 파괴적(테스트 데이터 생성·삭제) — assertWritableDb()로 운영 DB를 차단한다.
//    생성한 데이터는 끝에서 전부 정리한다(FK 역순).
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
// ★.mts(ESM) → lib/*.ts(CJS) 인터롭: tsx 환경에서 named export가 감지되지 않아
//  (`Object.keys(ns)` = ['default']) 이름 import가 런타임에 실패한다. 리포 전역 조건이며
//  traineePlacement·assignmentOverlap도 동일하다. 타입은 정상(named)이라 tsc를 만족시키려면
//  namespace import 후 default가 있으면 그것을, 없으면 namespace 자체를 쓴다.
import * as supervisionNs from "../lib/trainee/supervision";
type SupervisionModule = typeof import("../lib/trainee/supervision");
const supervisionModule =
  (supervisionNs as unknown as { default?: SupervisionModule }).default ??
  (supervisionNs as unknown as SupervisionModule);
const { createTraineeSupervision, createTraineeSupervisionInTx, closeTraineeSupervision } =
  supervisionModule;

const prisma = new PrismaClient();
let pass = 0, fail = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}

const D = (s: string) => new Date(s + "T00:00:00+09:00");

async function main() {
  await assertWritableDb();

  // ── 픽스처 ────────────────────────────────────────────────────
  const agency = await prisma.agency.create({ data: { name: `__sv_test_${Date.now()}` } });
  const site = await prisma.site.create({
    data: { companyName: "__sv_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
  });
  const site2 = await prisma.site.create({
    data: { companyName: "__sv_site2", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
  });
  const worker = await prisma.worker.create({
    data: { loginId: `__sv_${Date.now()}`, password: "x", workerName: "검증지도원", phoneNumber: `010${Date.now() % 100000000}`, role: "WORKER", status: "ACTIVE" },
  });
  const assignment = await prisma.siteAssignment.create({
    data: { workerId: worker.id, siteId: site.id, agencyId: agency.id, status: "ACTIVE", startDate: D("2026-08-01"), endDate: D("2026-08-31") },
  });
  const assignmentOtherSite = await prisma.siteAssignment.create({
    data: { workerId: worker.id, siteId: site2.id, agencyId: agency.id, status: "ACTIVE", startDate: D("2026-08-01"), endDate: D("2026-08-31") },
  });
  const trainee = await prisma.trainee.create({
    data: { name: "__sv_훈련생", gender: "M", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
  });
  const trainee2 = await prisma.trainee.create({
    data: { name: "__sv_훈련생2", gender: "F", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
  });
  const placement = await prisma.traineePlacement.create({
    data: { traineeId: trainee.id, siteId: site.id, startDate: D("2026-08-01"), endDate: D("2026-08-31") },
  });
  const placement2 = await prisma.traineePlacement.create({
    data: { traineeId: trainee2.id, siteId: site.id, startDate: D("2026-08-01"), endDate: D("2026-08-31") },
  });

  const createdIds: bigint[] = [];

  try {
    // ── 1. 정상 생성 ────────────────────────────────────────────
    console.log("\n[1] 정상 생성");
    const r1 = await createTraineeSupervision({
      traineeId: trainee.id, placementId: placement.id, assignmentId: assignment.id,
      startDate: D("2026-08-05"), endDate: D("2026-08-10"),
    });
    check("재적·배정 안의 담당 생성 성공", r1.ok === true, r1);
    if (r1.ok) createdIds.push(r1.id);

    const row = r1.ok ? await prisma.traineeSupervision.findUnique({ where: { id: r1.id } }) : null;
    check("DB에 실제로 저장됨", row != null);

    // ── 2. 중복 거부 ────────────────────────────────────────────
    console.log("\n[2] 동일 훈련생 기간 중복 거부");
    const r2 = await createTraineeSupervision({
      traineeId: trainee.id, placementId: placement.id, assignmentId: assignment.id,
      startDate: D("2026-08-08"), endDate: D("2026-08-15"),
    });
    check("겹치는 기간 거부", r2.ok === false && r2.code === "INVARIANT", r2);
    check("위반 코드가 OVERLAPPING_SUPERVISION",
      r2.ok === false && r2.code === "INVARIANT" && r2.violations.includes("OVERLAPPING_SUPERVISION"), r2);
    check("충돌 상대 id 반환", r2.ok === false && r2.code === "INVARIANT" && r2.conflictId === createdIds[0]);

    const cnt2 = await prisma.traineeSupervision.count({ where: { traineeId: trainee.id } });
    check("거부 시 행이 늘지 않음(롤백)", cnt2 === 1, { cnt2 });

    // ── 3. 겹치지 않으면 통과 ───────────────────────────────────
    console.log("\n[3] 인접 기간(겹침 없음)");
    const r3 = await createTraineeSupervision({
      traineeId: trainee.id, placementId: placement.id, assignmentId: assignment.id,
      startDate: D("2026-08-11"), endDate: D("2026-08-20"),
    });
    check("8/10 종료 → 8/11 시작은 통과", r3.ok === true, r3);
    if (r3.ok) createdIds.push(r3.id);

    // ── 4. 1:多 — 다른 훈련생 동시 담당은 정상 ──────────────────
    console.log("\n[4] 같은 직무지도원이 다른 훈련생을 같은 기간 담당(1:多 근거)");
    const r4 = await createTraineeSupervision({
      traineeId: trainee2.id, placementId: placement2.id, assignmentId: assignment.id,
      startDate: D("2026-08-05"), endDate: D("2026-08-10"),
    });
    check("허용되어야 함", r4.ok === true, r4);
    if (r4.ok) createdIds.push(r4.id);

    // ── 5. 불변식 위반들 ────────────────────────────────────────
    console.log("\n[5] 불변식 위반 거부");
    const rSite = await createTraineeSupervision({
      traineeId: trainee.id, placementId: placement.id, assignmentId: assignmentOtherSite.id,
      startDate: D("2026-08-22"), endDate: D("2026-08-25"),
    });
    check("배정 현장 ≠ 재적 현장 거부",
      rSite.ok === false && rSite.code === "INVARIANT" && rSite.violations.includes("SITE_MISMATCH"), rSite);

    const rRange = await createTraineeSupervision({
      traineeId: trainee.id, placementId: placement.id, assignmentId: assignment.id,
      startDate: D("2026-07-20"), endDate: D("2026-07-25"),
    });
    check("재적 기간 밖 거부",
      rRange.ok === false && rRange.code === "INVARIANT" && rRange.violations.includes("OUTSIDE_PLACEMENT"), rRange);

    const rNotFound = await createTraineeSupervision({
      traineeId: trainee.id, placementId: BigInt(999999999), assignmentId: assignment.id,
      startDate: D("2026-08-22"), endDate: D("2026-08-25"),
    });
    check("없는 재적 id → NOT_FOUND", rNotFound.ok === false && rNotFound.code === "NOT_FOUND", rNotFound);

    // ── 6. 동시 요청에서 불변식 강제 (락의 실효 검증) ───────────
    console.log("\n[6] 동시 요청 — 같은 훈련생·같은 기간 2건 동시 생성");
    const concurrent = await Promise.all([
      createTraineeSupervision({
        traineeId: trainee.id, placementId: placement.id, assignmentId: assignment.id,
        startDate: D("2026-08-22"), endDate: D("2026-08-25"),
      }),
      createTraineeSupervision({
        traineeId: trainee.id, placementId: placement.id, assignmentId: assignment.id,
        startDate: D("2026-08-23"), endDate: D("2026-08-24"),
      }),
    ]);
    const okCount = concurrent.filter((r) => r.ok).length;
    check("★정확히 1건만 성공(락이 TOCTOU를 막음)", okCount === 1, concurrent);
    for (const r of concurrent) if (r.ok) createdIds.push(r.id);

    const overlapRows = await prisma.traineeSupervision.findMany({
      where: { traineeId: trainee.id, startDate: { gte: D("2026-08-21") } },
    });
    check("겹치는 구간에 행이 1개만 존재", overlapRows.length === 1, { n: overlapRows.length });

    // ── 7. 종료(삭제 아님) ──────────────────────────────────────
    console.log("\n[7] 담당 종료");
    const openRes = await createTraineeSupervision({
      traineeId: trainee2.id, placementId: placement2.id, assignmentId: assignment.id,
      startDate: D("2026-08-15"), endDate: null,
    });
    check("담당만 열려 있고 재적은 8/31로 닫혀 있으면 거부",
      openRes.ok === false && openRes.code === "INVARIANT", openRes);

    // 종료 대상: 열린 재적/배정 아래 열린 담당을 만들어야 한다.
    const openPlacement = await prisma.traineePlacement.create({
      data: { traineeId: trainee2.id, siteId: site2.id, startDate: D("2026-09-01"), endDate: null },
    });
    const openAssignment = await prisma.siteAssignment.create({
      data: { workerId: worker.id, siteId: site2.id, agencyId: agency.id, status: "ACTIVE", startDate: D("2026-09-01"), endDate: null },
    });
    const openSup = await createTraineeSupervision({
      traineeId: trainee2.id, placementId: openPlacement.id, assignmentId: openAssignment.id,
      startDate: D("2026-09-05"), endDate: null,
    });
    check("열린 재적·배정 아래 열린 담당 생성 성공", openSup.ok === true, openSup);

    if (openSup.ok) {
      createdIds.push(openSup.id);

      // ★종료일 역전 거부
      const bad = await closeTraineeSupervision(openSup.id, D("2026-09-01"));
      check("★시작일보다 이른 종료일 거부",
        bad.ok === false && bad.code === "INVALID_RANGE", bad);

      const stillOpen = await prisma.traineeSupervision.findUnique({ where: { id: openSup.id } });
      check("거부 시 endDate가 그대로 null", stillOpen?.endDate == null);

      // 정상 종료
      const good = await closeTraineeSupervision(openSup.id, D("2026-09-20"));
      check("정상 종료 성공", good.ok === true, good);

      const closedRow = await prisma.traineeSupervision.findUnique({ where: { id: openSup.id } });
      check("endDate가 기록됨(삭제 아님)", closedRow != null && closedRow.endDate != null);

      // 재종료 거부
      const again = await closeTraineeSupervision(openSup.id, D("2026-09-25"));
      check("이미 종료된 관계 재종료 거부",
        again.ok === false && again.code === "ALREADY_CLOSED", again);

      // 시작일과 같은 날 종료는 허용(하루짜리 담당)
      const sameDay = await createTraineeSupervision({
        traineeId: trainee2.id, placementId: openPlacement.id, assignmentId: openAssignment.id,
        startDate: D("2026-10-01"), endDate: null,
      });
      if (sameDay.ok) {
        createdIds.push(sameDay.id);
        const r = await closeTraineeSupervision(sameDay.id, D("2026-10-01"));
        check("시작일과 같은 날 종료는 허용", r.ok === true, r);
      }
    }

    const closeMissing = await closeTraineeSupervision(BigInt(999999999), D("2026-09-20"));
    check("없는 id 종료 → NOT_FOUND",
      closeMissing.ok === false && closeMissing.code === "NOT_FOUND", closeMissing);

    // ── 8. 외부 트랜잭션 합류 ───────────────────────────────────
    console.log("\n[8] 기존 트랜잭션에 합류(3단계 초대 수락 대비)");
    // 성공: 한 트랜잭션에서 배정 + 담당 관계를 함께 생성
    const joined = await prisma.$transaction(async (tx) => {
      const asg = await tx.siteAssignment.create({
        data: { workerId: worker.id, siteId: site2.id, agencyId: agency.id, status: "ACTIVE", startDate: D("2026-11-01"), endDate: D("2026-11-30") },
      });
      const plc = await tx.traineePlacement.create({
        data: { traineeId: trainee2.id, siteId: site2.id, startDate: D("2026-11-01"), endDate: D("2026-11-30") },
      });
      const sup = await createTraineeSupervisionInTx(tx, {
        traineeId: trainee2.id, placementId: plc.id, assignmentId: asg.id,
        startDate: D("2026-11-05"), endDate: D("2026-11-10"),
      });
      return { asgId: asg.id, plcId: plc.id, sup };
    });
    check("같은 트랜잭션에서 배정+재적+담당 생성 성공", joined.sup.ok === true, joined.sup);
    if (joined.sup.ok) createdIds.push(joined.sup.id);

    // 롤백: 담당 생성이 불변식에 걸리면 호출부가 throw해 배정까지 함께 롤백되어야 한다
    const beforeAsg = await prisma.siteAssignment.count({ where: { workerId: worker.id } });
    let rolledBack = false;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.siteAssignment.create({
          data: { workerId: worker.id, siteId: site2.id, agencyId: agency.id, status: "ACTIVE", startDate: D("2026-12-01"), endDate: D("2026-12-31") },
        });
        const sup = await createTraineeSupervisionInTx(tx, {
          traineeId: trainee2.id, placementId: joined.plcId, assignmentId: joined.asgId,
          startDate: D("2026-11-05"), endDate: D("2026-11-10"), // 위와 겹침 → 거부
        });
        if (!sup.ok) throw new Error("INVARIANT_ROLLBACK");
      });
    } catch (e) {
      rolledBack = (e as Error).message === "INVARIANT_ROLLBACK";
    }
    check("★불변식 위반 시 호출부 throw로 전체 롤백", rolledBack);
    const afterAsg = await prisma.siteAssignment.count({ where: { workerId: worker.id } });
    check("롤백되어 배정이 늘지 않음", beforeAsg === afterAsg, { beforeAsg, afterAsg });
  } finally {
    // ── 정리 (FK 역순) ──────────────────────────────────────────
    console.log("\n[정리]");
    const c = new CleanupGuard();
    await c.step("supervision", () => prisma.traineeSupervision.deleteMany({ where: { traineeId: { in: [trainee.id, trainee2.id] } } }));
    await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { traineeId: { in: [trainee.id, trainee2.id] } } }));
    await c.step("trainee", () => prisma.trainee.deleteMany({ where: { id: { in: [trainee.id, trainee2.id] } } }));
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { workerId: worker.id } }));
    await c.step("site", () => prisma.site.deleteMany({ where: { id: { in: [site.id, site2.id] } } }));
    await c.step("worker", () => prisma.worker.delete({ where: { id: worker.id } }));
    await c.step("agency", () => prisma.agency.delete({ where: { id: agency.id } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__sv_"]);
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
