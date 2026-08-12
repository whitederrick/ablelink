// scripts/verify-pilot-purge.mts
// 파일럿 데이터 폐기 검증 — v1.8 §11, §12 9단계.
// 실행: npx tsx scripts/verify-pilot-purge.mts
//
// ★이 스크립트의 주된 관심사는 "지워졌는가"가 아니라 **"안 지워져야 할 것이 남았는가"**다.
//   파일럿은 실제 위탁기관에서 돌고 기존 Worker·재사용 Site/Trainee가 섞여 있다.
//   폐기가 조금이라도 넓게 잡으면 운영 데이터가 사라진다. 그래서 보존 단언을 먼저 세운다.
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

function interop<T>(ns: unknown): T { return (ns as { default?: T }).default ?? (ns as T); }
const purgeNs = await import("../lib/pilot/purge");
const { previewPilotPurge, purgePilotSession } = interop<typeof import("../lib/pilot/purge")>(purgeNs);

const prisma = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`, detail !== undefined ? JSON.stringify(detail, bi) : ""); }
}
function bi(_k: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v; }

async function main() {
  await assertWritableDb();
  const stamp = Date.now();
  const c = new CleanupGuard();

  // 픽스처는 전부 try 안에서 만든다(중간에 죽어도 정리된다).
  let agency: { id: bigint } | null = null;
  let admin: { id: bigint } | null = null;
  const sessionIds: bigint[] = [];
  const siteIds: bigint[] = [];
  const workerIds: bigint[] = [];
  const traineeIds: bigint[] = [];

  try {
    agency = await prisma.agency.create({ data: { name: `__pg_ag_${stamp}`, planType: "PRO" } });
    admin = await prisma.admin.create({
      data: { loginId: `__pg_adm_${stamp}`, passwordHash: "x", displayName: "운영자" },
    });
    const AG = agency, AD = admin;

    // ── 운영(비파일럿) 자산 — 폐기 후에도 그대로여야 한다 ──
    const reusedSite = await prisma.site.create({
      data: { companyName: "__pg_site_reused", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: AG.id },
    });
    siteIds.push(reusedSite.id);
    const reusedTrainee = await prisma.trainee.create({
      data: { name: "__pg_tr_reused", gender: "F", disabilityType: "지적", severity: "심한", currentSiteId: reusedSite.id },
    });
    traineeIds.push(reusedTrainee.id);
    const existingWorker = await prisma.worker.create({
      data: {
        loginId: `__pg_w_exist_${stamp}`, password: "x", workerName: "기존지도원",
        phoneNumber: `0115${String(stamp).slice(-7)}`, role: "WORKER", status: "ACTIVE", planType: "PRO",
      },
    });
    workerIds.push(existingWorker.id);
    // 파일럿과 무관한 정상 배정 — 이것이 사라지면 즉시 실패다.
    const normalAssignment = await prisma.siteAssignment.create({
      data: {
        workerId: existingWorker.id, siteId: reusedSite.id, agencyId: AG.id,
        status: "ACTIVE", workType: "FULL_DAY", startDate: D("2026-01-01"), endDate: D("2026-12-31"),
      },
    });

    // ── 파일럿 회차(ENDED) ──
    const session = await prisma.pilotSession.create({
      data: {
        agencyId: AG.id, startDate: D("2026-08-01"), endDate: D("2026-08-31"),
        createdByAdminId: AD.id, status: "ENDED", activatedAt: new Date(), endedAt: new Date(),
      },
    });
    sessionIds.push(session.id);

    // 회차가 만든 자원
    const pilotSite = await prisma.site.create({
      data: {
        companyName: "__pg_site_created", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
        agencyId: AG.id, createdByPilotSessionId: session.id,
      },
    });
    siteIds.push(pilotSite.id);
    const pilotTrainee = await prisma.trainee.create({
      data: {
        name: "__pg_tr_created", gender: "M", disabilityType: "지적", severity: "심하지 않은",
        currentSiteId: pilotSite.id, createdByPilotSessionId: session.id,
      },
    });
    traineeIds.push(pilotTrainee.id);
    const pilotWorker = await prisma.worker.create({
      data: {
        loginId: `__pg_w_new_${stamp}`, password: "x", workerName: "신규지도원",
        phoneNumber: `0116${String(stamp).slice(-7)}`, role: "WORKER", status: "ACTIVE",
        planType: "STANDARD", createdByPilotSessionId: session.id,
      },
    });
    workerIds.push(pilotWorker.id);

    // 파일럿 배정 + 딸린 데이터
    const pilotAssignment = await prisma.siteAssignment.create({
      data: {
        workerId: pilotWorker.id, siteId: pilotSite.id, agencyId: AG.id, pilotSessionId: session.id,
        status: "ACTIVE", workType: "FULL_DAY", startDate: D("2026-08-01"), endDate: D("2026-08-31"),
      },
    });
    const placement = await prisma.traineePlacement.create({
      data: { traineeId: pilotTrainee.id, siteId: pilotSite.id, startDate: D("2026-08-01"), pilotSessionId: session.id },
    });
    await prisma.traineeSupervision.create({
      data: {
        traineeId: pilotTrainee.id, placementId: placement.id, assignmentId: pilotAssignment.id,
        startDate: D("2026-08-01"), pilotSessionId: session.id,
      },
    });
    const att = await prisma.dailyAttendance.create({
      data: {
        workerId: pilotWorker.id, siteId: pilotSite.id, assignmentId: pilotAssignment.id,
        workDate: "2026-08-05", startTime: new Date(), endTime: new Date(), status: "DONE",
      },
    });
    await prisma.traineeLog.create({
      data: { traineeId: pilotTrainee.id, writerId: pilotWorker.id, trainingType: "FIELD", attendanceId: att.id },
    });
    const run = await prisma.documentRun.create({
      data: {
        agencyId: AG.id, assignmentId: pilotAssignment.id, siteId: pilotSite.id, workerId: pilotWorker.id,
        docType: "ATTENDANCE_SHEET", periodStart: D("2026-08-01"), periodEnd: D("2026-08-31"),
        openAt: new Date(), dueAt: D("2026-08-31"),
      },
    });
    const invite = await prisma.workerInvite.create({
      data: {
        agencyId: AG.id, siteId: pilotSite.id, pilotSessionId: session.id, createdByAdminId: AD.id,
        phoneNumber: "01099998888", code: "123456", expiresAt: new Date(Date.now() + 864e5),
      },
    });
    const participant = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: session.id, workerId: pilotWorker.id, siteId: pilotSite.id, status: "ACCEPTED",
        assignmentStartDate: D("2026-08-01"), assignmentEndDate: D("2026-08-31"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
        createdAssignmentId: pilotAssignment.id, inviteId: invite.id, acceptedAt: new Date(),
      },
    });
    await prisma.pilotParticipantTrainee.create({
      data: { participantId: participant.id, traineeId: pilotTrainee.id },
    });

    // ── ① 미리보기 ───────────────────────────────────────────
    console.log("\n[①] 폐기 미리보기 — 누르기 전에 숫자를 본다");
    const pv = await previewPilotPurge(session.id);
    check("미리보기 성공", pv.ok, pv);
    if (pv.ok) {
      check("삭제 대상 집계가 실제와 일치",
        pv.value.assignments === 1 && pv.value.attendances === 1 && pv.value.documentRuns === 1 &&
        pv.value.invites === 1 && pv.value.supervisions === 1 && pv.value.placements === 1 &&
        pv.value.participantTrainees === 1, pv.value);
      check("★회차가 만든 현장·훈련생만 삭제 대상(재사용분은 세지 않는다)",
        pv.value.sitesDeleted === 1 && pv.value.traineesDeleted === 1, pv.value);
      check("신규 Worker는 삭제가 아니라 정지 대상으로 집계", pv.value.workersPaused === 1, pv.value);
    }

    // ── ② 상태 게이트 ────────────────────────────────────────
    console.log("\n[②] ENDED에서만 폐기");
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "READY" } });
    const active = await purgePilotSession(session.id);
    check("★종료되지 않은(READY) 회차 폐기 시도 → 409 거부", !active.ok && active.code === "NOT_ENDED", active);
    const stillAssigned = await prisma.siteAssignment.count({ where: { pilotSessionId: session.id } });
    check("★거부됐으면 아무것도 안 지워졌다", stillAssigned === 1);
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ENDED" } });

    // ── ③ 폐기 실행 ──────────────────────────────────────────
    console.log("\n[③] 폐기 실행");
    const res = await purgePilotSession(session.id);
    check("폐기 성공", res.ok, res);

    console.log("\n[④] 지워져야 할 것");
    check("파일럿 배정 0", (await prisma.siteAssignment.count({ where: { pilotSessionId: session.id } })) === 0);
    check("근태 0(배정 Cascade)", (await prisma.dailyAttendance.count({ where: { id: att.id } })) === 0);
    check("★일지 0(근태 Cascade — 두 단계 연쇄가 실제로 도는가)",
      (await prisma.traineeLog.count({ where: { traineeId: pilotTrainee.id } })) === 0);
    check("문서 run 0(파일럿 PDF·서명 토큰 정리)", (await prisma.documentRun.count({ where: { id: run.id } })) === 0);
    check("초대 0", (await prisma.workerInvite.count({ where: { id: invite.id } })) === 0);
    check("담당 관계 0", (await prisma.traineeSupervision.count({ where: { pilotSessionId: session.id } })) === 0);
    check("재적 0", (await prisma.traineePlacement.count({ where: { pilotSessionId: session.id } })) === 0);
    check("회차가 만든 현장 삭제", (await prisma.site.count({ where: { id: pilotSite.id } })) === 0);
    check("회차가 만든 훈련생 삭제", (await prisma.trainee.count({ where: { id: pilotTrainee.id } })) === 0);

    console.log("\n[⑤] ★남아야 할 것 — 이쪽이 더 중요하다");
    check("★실제 위탁기관 보존", (await prisma.agency.count({ where: { id: AG.id } })) === 1);
    check("★재사용 현장 보존", (await prisma.site.count({ where: { id: reusedSite.id } })) === 1);
    check("★재사용 훈련생 보존", (await prisma.trainee.count({ where: { id: reusedTrainee.id } })) === 1);
    const ew = await prisma.worker.findUnique({ where: { id: existingWorker.id }, select: { status: true } });
    check("★기존 Worker 보존 + 상태 무변경(ACTIVE)", ew?.status === "ACTIVE", ew);
    check("★파일럿과 무관한 정상 배정 보존",
      (await prisma.siteAssignment.count({ where: { id: normalAssignment.id } })) === 1);

    const nw = await prisma.worker.findUnique({
      where: { id: pilotWorker.id }, select: { status: true, sessionVersion: true },
    });
    check("★신규 Worker는 삭제가 아니라 PAUSED(감사 로그의 행위자를 지우지 않는다)",
      nw !== null && nw.status === "PAUSED", nw);
    check("★sessionVersion 증가로 로그인 차단", (nw?.sessionVersion ?? 0) >= 1, nw);

    const ps = await prisma.pilotSession.findUnique({
      where: { id: session.id }, select: { status: true, purgedAt: true },
    });
    check("회차는 보존 + PURGED + purgedAt", ps?.status === "PURGED" && ps?.purgedAt !== null, ps);
    const pp = await prisma.pilotParticipant.findUnique({
      where: { id: participant.id },
      select: { purgedAt: true, inviteId: true, createdAssignmentId: true, workerId: true },
    });
    check("★참여 이력 보존 + 끊어진 참조만 정리",
      pp !== null && pp.purgedAt !== null && pp.inviteId === null && pp.createdAssignmentId === null, pp);
    check("참여자-훈련생 조인은 삭제",
      (await prisma.pilotParticipantTrainee.count({ where: { participantId: participant.id } })) === 0);

    // ── ⑥ 재폐기 ─────────────────────────────────────────────
    console.log("\n[⑥] 재실행");
    const again = await purgePilotSession(session.id);
    check("★PURGED 회차 재폐기 → 409(멱등이 아니라 명시적 거부)",
      !again.ok && again.code === "NOT_ENDED", again);
    const ghost = await purgePilotSession(BigInt("9999999999"));
    check("없는 회차 → 404", !ghost.ok && ghost.code === "NOT_FOUND", ghost);

    // ── ⑦ 참조가 생긴 회차 생성 자원은 보존 ──────────────────
    console.log("\n[⑦] 회차가 만들었어도 파일럿 밖 참조가 있으면 보존");
    const s2 = await prisma.pilotSession.create({
      data: {
        agencyId: AG.id, startDate: D("2026-09-01"), endDate: D("2026-09-30"),
        createdByAdminId: AD.id, status: "ENDED", endedAt: new Date(),
      },
    });
    sessionIds.push(s2.id);
    const site2 = await prisma.site.create({
      data: {
        companyName: "__pg_site_used", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
        agencyId: AG.id, createdByPilotSessionId: s2.id,
      },
    });
    siteIds.push(site2.id);
    // 파일럿 밖(정상) 배정이 이 현장에 생겼다 → 더는 파일럿만의 자원이 아니다.
    const normalOnPilotSite = await prisma.siteAssignment.create({
      data: {
        workerId: existingWorker.id, siteId: site2.id, agencyId: AG.id,
        status: "ACTIVE", workType: "AM", startDate: D("2026-09-01"), endDate: D("2026-09-30"),
      },
    });
    const pv2 = await previewPilotPurge(s2.id);
    check("★정상 배정이 붙은 현장은 삭제 대상에서 빠지고 kept로 잡힌다",
      pv2.ok && pv2.value.sitesDeleted === 0 && pv2.value.sitesKept === 1, pv2);
    const r2 = await purgePilotSession(s2.id);
    check("폐기 성공", r2.ok, r2);
    check("★그 현장이 실제로 살아 있다", (await prisma.site.count({ where: { id: site2.id } })) === 1);
    check("★그 현장의 정상 배정도 살아 있다",
      (await prisma.siteAssignment.count({ where: { id: normalOnPilotSite.id } })) === 1);

  } finally {
    console.log("\n[정리]");
    const aId = agency?.id;
    if (workerIds.length) {
      await c.step("traineeLog", () => prisma.traineeLog.deleteMany({ where: { writerId: { in: workerIds } } }));
      await c.step("dailyAttendance", () => prisma.dailyAttendance.deleteMany({ where: { workerId: { in: workerIds } } }));
    }
    if (aId) {
      await c.step("documentRun", () => prisma.documentRun.deleteMany({ where: { agencyId: aId } }));
      await c.step("workerInvite", () => prisma.workerInvite.deleteMany({ where: { agencyId: aId } }));
    }
    await c.step("supervision", () => prisma.traineeSupervision.deleteMany({ where: { traineeId: { in: traineeIds } } }));
    if (aId) await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { agencyId: aId } }));
    await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { traineeId: { in: traineeIds } } }));
    for (const sid of sessionIds) {
      await c.step(`participantTrainee#${sid}`, () => prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: sid } } }));
      await c.step(`participant#${sid}`, () => prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: sid } }));
      await c.step(`pilotSession#${sid}`, () => prisma.pilotSession.delete({ where: { id: sid } }));
    }
    if (traineeIds.length) await c.step("trainee", () => prisma.trainee.deleteMany({ where: { id: { in: traineeIds } } }));
    if (workerIds.length) await c.step("worker", () => prisma.worker.deleteMany({ where: { id: { in: workerIds } } }));
    if (siteIds.length) await c.step("site", () => prisma.site.deleteMany({ where: { id: { in: siteIds } } }));
    if (admin) await c.step("admin", () => prisma.admin.delete({ where: { id: admin!.id } }));
    if (aId) await c.step("agency", () => prisma.agency.delete({ where: { id: aId } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__pg_"]);
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
