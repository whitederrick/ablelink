// scripts/verify-pilot-session.mts
// 파일럿 회차 스키마 제약 검증 — v1.8 §12 2단계.
// 실행: npx tsx scripts/verify-pilot-session.mts
//
// 스키마 단계에서 확인할 것은 "DB가 실제로 막아 주는가"다. 애플리케이션 로직(3단계 이후)이
// 실수해도 아래 제약이 최종 방어선으로 작동해야 한다.
//   · ACTIVE 회차 전역 1개 (partial unique index)
//   · WorkerInvite 발급자 XOR (CHECK)
//   · 같은 회차에 같은 Worker 중복 참여 금지 (unique, NULL은 공존)
//   · invite_id / created_assignment_id 유일성
//
// ⚠️ 파괴적(테스트 데이터 생성·삭제) — assertWritableDb()로 운영 DB를 차단한다.
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

const prisma = new PrismaClient();
let pass = 0, fail = 0;

function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}

/** 제약 위반으로 거부되어야 하는 쓰기. 성공하면 실패로 본다. */
async function expectReject(name: string, fn: () => Promise<unknown>, expectFragment?: string) {
  try {
    await fn();
    check(name, false, "거부되지 않고 성공했다");
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    const matched = expectFragment ? msg.includes(expectFragment) : true;
    check(name, matched, matched ? undefined : msg.slice(0, 200));
  }
}

const D = (s: string) => new Date(s + "T00:00:00Z");

async function main() {
  await assertWritableDb();

  const stamp = Date.now();
  const agency = await prisma.agency.create({ data: { name: `__ps_test_${stamp}` } });
  const admin = await prisma.admin.create({
    data: { loginId: `__ps_admin_${stamp}`, passwordHash: "x", displayName: "검증운영자" },
  });
  const manager = await prisma.manager.create({
    data: { loginId: `__ps_mgr_${stamp}`, passwordHash: "x", agencyId: agency.id },
  });
  const site = await prisma.site.create({
    data: { companyName: "__ps_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
  });
  const worker = await prisma.worker.create({
    data: { loginId: `__ps_w_${stamp}`, password: "x", workerName: "검증지도원", phoneNumber: `010${stamp % 100000000}`, role: "WORKER", status: "ACTIVE" },
  });

  const sessionIds: bigint[] = [];
  let agency2Id: bigint | null = null;

  try {
    // ── 1. 회차 생성 ────────────────────────────────────────────
    console.log("\n[1] 회차 생성");
    const s1 = await prisma.pilotSession.create({
      data: {
        agencyId: agency.id, createdByAdminId: admin.id,
        startDate: D("2026-09-01"), endDate: D("2026-09-30"),
      },
    });
    sessionIds.push(s1.id);
    check("DRAFT로 생성됨", s1.status === "DRAFT", s1.status);
    check("담당자 표시명은 비어 있어도 됨", s1.managerDisplayName == null);

    // ── 2. ★ACTIVE 전역 1개 ────────────────────────────────────
    console.log("\n[2] ACTIVE 회차 전역 1개");
    await prisma.pilotSession.update({ where: { id: s1.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
    check("첫 회차 ACTIVE 전환 성공", true);

    const s2 = await prisma.pilotSession.create({
      data: {
        agencyId: agency.id, createdByAdminId: admin.id,
        startDate: D("2026-10-01"), endDate: D("2026-10-31"),
      },
    });
    sessionIds.push(s2.id);
    await expectReject(
      "★두 번째 ACTIVE 전환 거부(partial unique index)",
      () => prisma.pilotSession.update({ where: { id: s2.id }, data: { status: "ACTIVE" } }),
    );

    // 다른 기관이어도 전역 1개다
    agency2Id = (await prisma.agency.create({ data: { name: `__ps_test2_${stamp}` } })).id;
    const s3 = await prisma.pilotSession.create({
      data: { agencyId: agency2Id!, createdByAdminId: admin.id, startDate: D("2026-11-01"), endDate: D("2026-11-30") },
    });
    sessionIds.push(s3.id);
    await expectReject(
      "★다른 기관이어도 두 번째 ACTIVE 거부(전역 제약)",
      () => prisma.pilotSession.update({ where: { id: s3.id }, data: { status: "ACTIVE" } }),
    );
    // ★여기서 지우지 않는다 — 아직 s3가 이 기관을 참조하므로 FK로 실패하고,
    //  실패를 삼키면 테스트 기관이 남아 운영자 기관 드롭다운에 노출된다(실제로 그랬다).
    //  정리는 finally에서 회차를 먼저 지운 뒤 수행한다.

    // ENDED로 내리면 다음 회차가 ACTIVE 될 수 있다
    await prisma.pilotSession.update({ where: { id: s1.id }, data: { status: "ENDED", endedAt: new Date() } });
    await prisma.pilotSession.update({ where: { id: s2.id }, data: { status: "ACTIVE" } });
    check("앞 회차 종료 후 다음 회차 ACTIVE 가능", true);
    await prisma.pilotSession.update({ where: { id: s2.id }, data: { status: "DRAFT" } });

    // ── 3. ★초대 발급자 XOR ────────────────────────────────────
    console.log("\n[3] WorkerInvite 발급자 XOR");
    const inviteAdmin = await prisma.workerInvite.create({
      data: {
        agencyId: agency.id, phoneNumber: "01011112222", code: `c${stamp}a`,
        expiresAt: D("2026-12-31"), createdByAdminId: admin.id, pilotSessionId: s1.id,
      },
    });
    check("운영자 발급 초대 생성 성공(파일럿)", inviteAdmin.createdByAdminId === admin.id);

    const inviteManager = await prisma.workerInvite.create({
      data: {
        agencyId: agency.id, phoneNumber: "01011113333", code: `c${stamp}m`,
        expiresAt: D("2026-12-31"), createdByManagerId: manager.id,
      },
    });
    check("기존 매니저 발급 초대 동작 불변", inviteManager.createdByManagerId === manager.id);

    await expectReject("★발급자 둘 다 있으면 거부", () =>
      prisma.workerInvite.create({
        data: {
          agencyId: agency.id, phoneNumber: "01011114444", code: `c${stamp}b`,
          expiresAt: D("2026-12-31"), createdByManagerId: manager.id, createdByAdminId: admin.id,
        },
      }),
    );
    await expectReject("★발급자 둘 다 없으면 거부", () =>
      prisma.workerInvite.create({
        data: {
          agencyId: agency.id, phoneNumber: "01011115555", code: `c${stamp}n`,
          expiresAt: D("2026-12-31"),
        },
      }),
    );

    // ── 4. 참여자 제약 ──────────────────────────────────────────
    console.log("\n[4] 참여자 제약");
    const p1 = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: s1.id, workerId: worker.id, siteId: site.id,
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      },
    });
    check("기존 Worker 참여자 생성", p1.status === "CONFIGURED");
    check("근태 기본값이 파일럿 기준(NONE·면제)",
      p1.attendanceMode === "NONE" && p1.attendanceButtonExempt === true, p1);

    await expectReject("같은 회차에 같은 Worker 중복 참여 거부", () =>
      prisma.pilotParticipant.create({
        data: {
          pilotSessionId: s1.id, workerId: worker.id, siteId: site.id,
          assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
          serviceStep: "FIELD_TRAINING", workType: "AM",
        },
      }),
    );

    // 신규 Worker 대기 행(workerId=NULL)은 여러 개 공존한다
    const pNull1 = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: s1.id, siteId: site.id, inviteId: inviteAdmin.id,
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "AM",
      },
    });
    const pNull2 = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: s1.id, siteId: site.id,
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "PM",
      },
    });
    check("★신규 Worker 대기 행(workerId=NULL) 2건 공존", pNull1.id !== pNull2.id);

    await expectReject("같은 초대를 두 참여자가 공유 불가(invite_id unique)", () =>
      prisma.pilotParticipant.create({
        data: {
          pilotSessionId: s1.id, siteId: site.id, inviteId: inviteAdmin.id,
          assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
          serviceStep: "FIELD_TRAINING", workType: "PM",
        },
      }),
    );

    // ── 5. 회차 FK 기록 ────────────────────────────────────────
    console.log("\n[5] 회차 참여 FK");
    const asg = await prisma.siteAssignment.create({
      data: {
        workerId: worker.id, siteId: site.id, agencyId: agency.id, status: "ACTIVE",
        startDate: D("2026-09-01"), endDate: D("2026-09-30"), pilotSessionId: s1.id,
      },
    });
    check("배정에 회차 기록", asg.pilotSessionId === s1.id);

    const normalAsg = await prisma.siteAssignment.create({
      data: {
        workerId: worker.id, siteId: site.id, agencyId: agency.id, status: "ACTIVE",
        startDate: D("2026-01-01"), endDate: D("2026-01-31"),
      },
    });
    check("정상 배정은 회차가 null(기관·기간이 같아도 파일럿 아님)", normalAsg.pilotSessionId == null);

    const pilotOnly = await prisma.siteAssignment.count({ where: { pilotSessionId: s1.id } });
    check("회차 id로만 파일럿을 골라낼 수 있음", pilotOnly === 1, { pilotOnly });

    // ── 6. 생성 출처(폐기 판정용) ──────────────────────────────
    console.log("\n[6] 회차 생성 출처");
    const createdSite = await prisma.site.create({
      data: {
        companyName: "__ps_created", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
        agencyId: agency.id, createdByPilotSessionId: s1.id,
      },
    });
    check("회차가 만든 현장에 출처 기록", createdSite.createdByPilotSessionId === s1.id);
    check("재사용한 기존 현장은 출처 없음(폐기 대상 아님)", site.createdByPilotSessionId == null);

    await prisma.site.delete({ where: { id: createdSite.id } });
  } finally {
    console.log("\n[정리]");
    const c = new CleanupGuard();
    await c.step("participantTrainee", () => prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: { in: sessionIds } } } }));
    await c.step("participant", () => prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: { in: sessionIds } } }));
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { workerId: worker.id } }));
    await c.step("invite", () => prisma.workerInvite.deleteMany({ where: { agencyId: agency.id } }));
    await c.step("site", () => prisma.site.deleteMany({ where: { agencyId: agency.id } }));
    // ★회차를 먼저 지워야 두 번째 기관(agency2)의 FK가 풀린다.
    await c.step("pilotSession", () => prisma.pilotSession.deleteMany({ where: { id: { in: sessionIds } } }));
    await c.step("worker", () => prisma.worker.delete({ where: { id: worker.id } }));
    await c.step("manager", () => prisma.manager.delete({ where: { id: manager.id } }));
    await c.step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await c.step("agency", () => prisma.agency.delete({ where: { id: agency.id } }));
    if (agency2Id) await c.step("agency2", () => prisma.agency.delete({ where: { id: agency2Id! } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__ps_"]);
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
