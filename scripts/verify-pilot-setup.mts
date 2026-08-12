// scripts/verify-pilot-setup.mts
// 파일럿 운영자 셋업 서버경로 검증 — v1.8 §12 4단계(4-A).
// 실행: npx tsx scripts/verify-pilot-setup.mts
//
// 접합부 6가지를 본다(리뷰어 지정 5 + 잠금 축 1):
//   ① 운영자 훈련생·사업체 생성(+createdByPilotSessionId 출처, 크로스테넌트 차단)
//   ② 기존 Worker 셋업이 락·정원 chokepoint를 경유
//   ③ 참여자 설정 기간 ⊆ 회차 기간
//   ④ 참여자 CANCELLED 시 초대 무효화
//   ⑤ READY→ACTIVE 전이 조건 + 전역 ACTIVE 1개
//   ⑥ ★회차 잠금 축 — 전이·발급·수락·연결이 같은 락에서 직렬화
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
// ★라우트 계층(HTTP)은 이 스크립트가 덮지 못한다 — tsx가 Next의 `server-only`를 해석하지 못해
//  app/api/** 를 import하면 MODULE_NOT_FOUND로 죽는다(node_modules/server-only 스텁이 필요한데
//  npm install이 지우므로 의존하지 않는다). 라우트 계층은 4-B 화면 스모크에서 덮는다.
import * as lockNs from "../lib/assignmentLock";
import * as overlapNs from "../lib/assignmentOverlap";
import * as sessionNs from "../lib/pilot/session";
import * as participantNs from "../lib/pilot/participant";
import * as resourcesNs from "../lib/pilot/resources";
import * as issueNs from "../lib/pilot/issueInvite";
import * as connectNs from "../lib/pilot/connectInvite";
import * as acceptNs from "../lib/pilot/acceptInvite";

function interop<T>(ns: unknown): T {
  return (ns as { default?: T }).default ?? (ns as T);
}
const { createPilotSession, updatePilotSession, transitionPilotSession } =
  interop<typeof import("../lib/pilot/session")>(sessionNs);
const { createPilotParticipant, cancelPilotParticipant } =
  interop<typeof import("../lib/pilot/participant")>(participantNs);
const { createPilotSite, createPilotTrainee } =
  interop<typeof import("../lib/pilot/resources")>(resourcesNs);
const { issuePilotInvite } = interop<typeof import("../lib/pilot/issueInvite")>(issueNs);
const { connectExistingPilotInvite } = interop<typeof import("../lib/pilot/connectInvite")>(connectNs);
const { acceptPilotInvite } = interop<typeof import("../lib/pilot/acceptInvite")>(acceptNs);
const { withWorkerAssignmentLock } = interop<typeof import("../lib/assignmentLock")>(lockNs);
const { findTimeConflict, OCCUPYING_STATUSES } =
  interop<typeof import("../lib/assignmentOverlap")>(overlapNs);

/** 경합 테스트용 신규 Worker 수락(라우트가 넘기는 것과 같은 형태). */
function acceptPilotInviteRace(inviteId: bigint, phone: string) {
  return acceptPilotInvite({
    inviteId,
    newWorker: {
      loginId: phone, phoneNumber: phone, workerName: "경합지도원", passwordHash: "hashed",
      consentTermsAt: new Date(), consentPrivacyAt: new Date(), consentLocationAt: null,
    },
  });
}

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}
const D = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  await assertWritableDb();
  const stamp = Date.now();

  const agency = await prisma.agency.create({ data: { name: `__ps4_${stamp}` } });
  const otherAgency = await prisma.agency.create({ data: { name: `__ps4_other_${stamp}` } });
  const admin = await prisma.admin.create({
    data: { loginId: `__ps4_adm_${stamp}`, passwordHash: "x", displayName: "운영자" },
  });
  const otherSite = await prisma.site.create({
    data: { companyName: "__ps4_other_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: otherAgency.id },
  });
  const exWorker = await prisma.worker.create({
    data: { loginId: `__ps4_w_${stamp}`, password: "x", workerName: "기존지도원", phoneNumber: `0111${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
  });

  let sessionId: bigint | null = null;

  try {
    // ── 회차 생성·기간 검증 ─────────────────────────────────────
    console.log("\n[회차] 생성과 기간 검증");
    const bad = await createPilotSession({
      agencyId: agency.id, startDate: D("2026-09-30"), endDate: D("2026-09-01"),
      createdByAdminId: admin.id,
    });
    check("종료일이 시작일보다 이르면 거부", bad.ok === false && bad.code === "INVALID_PERIOD", bad);

    const created = await createPilotSession({
      agencyId: agency.id, startDate: D("2026-09-01"), endDate: D("2026-09-30"),
      createdByAdminId: admin.id,
    });
    check("회차 생성 성공(DRAFT)", created.ok === true && created.value.status === "DRAFT", created);
    if (!created.ok) throw new Error("회차 생성 실패");
    sessionId = created.value.id;
    const sid = created.value.id;

    // ── ① 운영자 사업체·훈련생 생성 ────────────────────────────
    console.log("\n[①] 운영자 사업체·훈련생 생성");
    const siteRes = await createPilotSite({
      pilotSessionId: sid, companyName: "파일럿사업체", address: "서울시 성동구",
      gpsLat: 37.5, gpsLon: 127.0, businessContactName: "김사업",
    });
    check("사업체 생성 성공", siteRes.ok === true, siteRes);
    if (!siteRes.ok) throw new Error("사업체 생성 실패");
    const siteId = siteRes.value.id;

    const siteRow = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    check("★사업체에 생성 출처 기록(폐기 판정용)", siteRow.createdByPilotSessionId === sid);
    check("사업체가 회차 기관에 귀속", siteRow.agencyId === agency.id);
    check("파일럿 현장은 미검증 상태", siteRow.isVerified === false);

    const tr1 = await createPilotTrainee({
      pilotSessionId: sid, siteId, name: "훈련생하나", gender: "M",
      disabilityType: "지적", severity: "심하지않은",
    });
    check("훈련생 생성 성공", tr1.ok === true, tr1);
    if (!tr1.ok) throw new Error("훈련생 생성 실패");

    const trRow = await prisma.trainee.findUniqueOrThrow({ where: { id: tr1.value.id } });
    check("★훈련생에 생성 출처 기록", trRow.createdByPilotSessionId === sid);
    const plc = await prisma.traineePlacement.findFirst({ where: { traineeId: tr1.value.id } });
    check("★재적이 함께 생성됨(담당 관계 전제조건)", plc != null);
    check("재적에도 회차 기록", plc?.pilotSessionId === sid);

    // 크로스테넌트 차단
    const crossTrainee = await createPilotTrainee({
      pilotSessionId: sid, siteId: otherSite.id, name: "남의기관", gender: "F",
      disabilityType: "지적", severity: "심하지않은",
    });
    check("★다른 기관 현장에는 훈련생 생성 거부(크로스테넌트)",
      crossTrainee.ok === false && crossTrainee.code === "SITE_NOT_IN_SESSION", crossTrainee);

    // ── ③ 기간 ⊆ 회차 ─────────────────────────────────────────
    console.log("\n[③] 참여자 설정 기간 ⊆ 회차 기간");
    const outside = await createPilotParticipant({
      pilotSessionId: sid, siteId, workerId: null, traineeIds: [tr1.value.id],
      assignmentStartDate: D("2026-08-25"), assignmentEndDate: D("2026-09-30"),
      serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
    });
    check("★회차 시작 전에 시작하는 배정 거부",
      outside.ok === false && outside.code === "OUT_OF_SESSION_PERIOD", outside);

    const outside2 = await createPilotParticipant({
      pilotSessionId: sid, siteId, workerId: null, traineeIds: [tr1.value.id],
      assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-10-15"),
      serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
    });
    check("★회차 종료 후까지 이어지는 배정 거부",
      outside2.ok === false && outside2.code === "OUT_OF_SESSION_PERIOD", outside2);

    // ── ② 기존 Worker 셋업 — 배정·담당까지 ────────────────────
    console.log("\n[②] 기존 Worker 셋업(배정·담당 동시 생성)");
    const exPart = await createPilotParticipant({
      pilotSessionId: sid, siteId, workerId: exWorker.id, traineeIds: [tr1.value.id],
      assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
      serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
    });
    check("기존 Worker 참여자 생성 성공", exPart.ok === true, exPart);
    if (!exPart.ok) throw new Error("기존 Worker 셋업 실패");
    check("★배정이 함께 생성됨", exPart.value.assignmentId != null);

    const exAsg = await prisma.siteAssignment.findUniqueOrThrow({ where: { id: exPart.value.assignmentId! } });
    check("배정이 회차에 귀속", exAsg.pilotSessionId === sid);
    check("★기존 Worker 배정은 CONFIRMED(연결 대기)", exAsg.status === "CONFIRMED");
    check("근태 설정이 파일럿 기준", exAsg.attendanceMode === "NONE" && exAsg.attendanceButtonExempt === true);

    const exSup = await prisma.traineeSupervision.findMany({ where: { assignmentId: exAsg.id } });
    check("★담당 관계도 함께 생성됨", exSup.length === 1, { n: exSup.length });
    check("담당 관계에 회차 기록", exSup[0]?.pilotSessionId === sid);

    // 중복 참여 차단
    const dup = await createPilotParticipant({
      pilotSessionId: sid, siteId, workerId: exWorker.id, traineeIds: [tr1.value.id],
      assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
      serviceStep: "FIELD_TRAINING", workType: "AM",
    });
    check("같은 회차 같은 Worker 중복 참여 거부",
      dup.ok === false && dup.code === "WORKER_DUPLICATE", dup);

    // 정원 초과 차단(현장 락 안에서 검사)
    await prisma.site.update({ where: { id: siteId }, data: { amCapacity: 0 } });
    const w2 = await prisma.worker.create({
      data: { loginId: `__ps4_w2_${stamp}`, password: "x", workerName: "지도원2", phoneNumber: `0112${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
    });
    const tr2 = await createPilotTrainee({
      pilotSessionId: sid, siteId, name: "훈련생둘", gender: "F", disabilityType: "지적", severity: "심하지않은",
    });
    if (!tr2.ok) throw new Error("훈련생2 생성 실패");
    await prisma.site.update({ where: { id: siteId }, data: { amCapacity: 1 } });
    const capOk = await createPilotParticipant({
      pilotSessionId: sid, siteId, workerId: w2.id, traineeIds: [tr2.value.id],
      assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
      serviceStep: "FIELD_TRAINING", workType: "AM",
    });
    check("정원 여유가 있으면 통과", capOk.ok === true, capOk);

    const w3 = await prisma.worker.create({
      data: { loginId: `__ps4_w3_${stamp}`, password: "x", workerName: "지도원3", phoneNumber: `0113${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
    });
    const tr3 = await createPilotTrainee({
      pilotSessionId: sid, siteId, name: "훈련생셋", gender: "M", disabilityType: "지적", severity: "심하지않은",
    });
    if (!tr3.ok) throw new Error("훈련생3 생성 실패");
    const capOver = await createPilotParticipant({
      pilotSessionId: sid, siteId, workerId: w3.id, traineeIds: [tr3.value.id],
      assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
      serviceStep: "FIELD_TRAINING", workType: "AM",
    });
    check("★정원 초과 시 거부(chokepoint 경유)",
      capOver.ok === false && capOver.code === "CAPACITY_EXCEEDED", capOver);
    const w3Asg = await prisma.siteAssignment.count({ where: { workerId: w3.id } });
    check("★거부 시 배정이 생기지 않음(롤백)", w3Asg === 0);

    // ── ⑤ 상태 전이 ───────────────────────────────────────────
    console.log("\n[⑤] 상태 전이와 전역 ACTIVE 1개");
    const badTransition = await transitionPilotSession(sid, "ENDED");
    check("DRAFT→ENDED 금지", badTransition.ok === false && badTransition.code === "INVALID_TRANSITION", badTransition);

    const toReady = await transitionPilotSession(sid, "READY");
    check("DRAFT→READY 성공", toReady.ok === true, toReady);

    const noAccepted = await transitionPilotSession(sid, "ACTIVE");
    check("★수락자 0명이면 ACTIVE 거부",
      noAccepted.ok === false && noAccepted.code === "NO_ACCEPTED", noAccepted);

    // 기존 Worker 초대 발급 + 연결 → ACCEPTED 1명 확보
    const issued = await issuePilotInvite({
      sessionId: sid, participantId: exPart.value.participantId,
      phoneNumber: exWorker.phoneNumber!, createdByAdminId: admin.id,
    });
    check("기존 Worker 초대 발급 성공", issued.ok === true, issued);
    if (!issued.ok) throw new Error("발급 실패");

    const connected = await connectExistingPilotInvite({ workerId: exWorker.id, inviteId: issued.invite.id });
    check("연결 성공", connected.ok === true, connected);

    const stillPending = await transitionPilotSession(sid, "ACTIVE");
    check("★미응답 참여자가 남으면 ACTIVE 거부",
      stillPending.ok === false && stillPending.code === "PENDING_PARTICIPANTS", stillPending);

    // ── ④ 취소 + 초대 무효화 ──────────────────────────────────
    console.log("\n[④] 참여 취소와 초대 무효화");
    const pendingParts = await prisma.pilotParticipant.findMany({
      where: { pilotSessionId: sid, status: { in: ["CONFIGURED", "INVITED"] } },
      select: { id: true },
    });
    // 남은 참여자 중 하나에 초대를 발급해 두고 취소 → 초대가 무효화되는지 본다
    const target = pendingParts[0];
    const targetIssued = await issuePilotInvite({
      sessionId: sid, participantId: target.id,
      phoneNumber: `0114${stamp % 10000000}`, createdByAdminId: admin.id,
    });
    check("취소 대상 참여자에 초대 발급", targetIssued.ok === true, targetIssued);

    const cancelled = await cancelPilotParticipant(target.id);
    check("참여 취소 성공", cancelled.ok === true, cancelled);
    check("★연결 초대가 무효화됨", cancelled.ok === true && cancelled.value.invalidatedInvite === true);

    if (targetIssued.ok) {
      const inv = await prisma.workerInvite.findUniqueOrThrow({ where: { id: targetIssued.invite.id } });
      check("★초대 만료일이 과거로 당겨짐(수락 차단)", inv.expiresAt.getTime() < Date.now());
      check("초대 행은 보존됨(감사 근거)", inv.usedAt == null);
    }

    // 수락된 참여자는 취소 불가
    const cancelAccepted = await cancelPilotParticipant(exPart.value.participantId);
    check("★수락된 참여자는 취소 거부",
      cancelAccepted.ok === false && cancelAccepted.code === "ALREADY_ACCEPTED", cancelAccepted);

    // 나머지 미응답자 전부 취소 후 ACTIVE
    for (const p of pendingParts.slice(1)) await cancelPilotParticipant(p.id);
    const toActive = await transitionPilotSession(sid, "ACTIVE");
    check("★미응답자 정리 후 ACTIVE 성공", toActive.ok === true, toActive);

    // 전역 ACTIVE 1개
    const other = await createPilotSession({
      agencyId: otherAgency.id, startDate: D("2026-11-01"), endDate: D("2026-11-30"),
      createdByAdminId: admin.id,
    });
    if (other.ok) {
      await transitionPilotSession(other.value.id, "READY");
      const secondActive = await transitionPilotSession(other.value.id, "ACTIVE");
      check("★다른 기관 회차도 동시 ACTIVE 거부(전역 1개)",
        secondActive.ok === false, secondActive);
      await prisma.pilotSession.delete({ where: { id: other.value.id } });
    }

    // ── 상태별 불변성 ─────────────────────────────────────────
    console.log("\n[불변성] 상태별 수정 범위");
    const nameOnly = await updatePilotSession(sid, { managerDisplayName: "박위탁" });
    check("ACTIVE에서 담당자 표시명은 수정 가능", nameOnly.ok === true, nameOnly);

    const periodChange = await updatePilotSession(sid, { endDate: D("2026-10-31") });
    check("★ACTIVE에서 기간 수정 거부",
      periodChange.ok === false && periodChange.code === "IMMUTABLE_FIELD", periodChange);

    await transitionPilotSession(sid, "ENDED");
    const afterEnd = await updatePilotSession(sid, { managerDisplayName: "다른이름" });
    check("★ENDED 이후에는 표시명도 수정 거부(문서 재현성)",
      afterEnd.ok === false && afterEnd.code === "IMMUTABLE_FIELD", afterEnd);

    // ── ⑥ 회차 잠금 축 ────────────────────────────────────────
    console.log("\n[⑥] 회차 잠금 축 — 전이와 발급 동시 실행");
    const s2 = await createPilotSession({
      agencyId: agency.id, startDate: D("2026-12-01"), endDate: D("2026-12-31"),
      createdByAdminId: admin.id,
    });
    if (!s2.ok) throw new Error("회차2 생성 실패");
    const site2 = await createPilotSite({
      pilotSessionId: s2.value.id, companyName: "회차2사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
    });
    if (!site2.ok) throw new Error("회차2 사업체 실패");
    const tr4 = await createPilotTrainee({
      pilotSessionId: s2.value.id, siteId: site2.value.id, name: "훈련생넷",
      gender: "M", disabilityType: "지적", severity: "심하지않은",
    });
    if (!tr4.ok) throw new Error("회차2 훈련생 실패");
    const p2 = await createPilotParticipant({
      pilotSessionId: s2.value.id, siteId: site2.value.id, workerId: null, traineeIds: [tr4.value.id],
      assignmentStartDate: D("2026-12-01"), assignmentEndDate: D("2026-12-31"),
      serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
    });
    if (!p2.ok) throw new Error("회차2 참여자 실패");

    // 전이(READY→CANCELLED)와 발급을 동시에 — 락이 없으면 둘 다 통과해 닫힌 회차에 초대가 생긴다.
    await transitionPilotSession(s2.value.id, "READY");
    const [transitionR, issueR] = await Promise.all([
      transitionPilotSession(s2.value.id, "CANCELLED"),
      issuePilotInvite({
        sessionId: s2.value.id, participantId: p2.value.participantId,
        phoneNumber: `0115${stamp % 10000000}`, createdByAdminId: admin.id,
      }),
    ]);
    const sessionAfter = await prisma.pilotSession.findUniqueOrThrow({ where: { id: s2.value.id } });
    const inviteCount = await prisma.workerInvite.count({ where: { pilotSessionId: s2.value.id } });
    // 락이 있으면 둘은 직렬화된다 — 전이가 먼저면 발급 거부, 발급이 먼저면 둘 다 성공.
    const consistent =
      (sessionAfter.status === "CANCELLED" && !issueR.ok && inviteCount === 0) ||
      (sessionAfter.status === "CANCELLED" && issueR.ok && inviteCount === 1) ||
      (sessionAfter.status === "READY" && issueR.ok);
    check("★전이·발급 동시 실행이 직렬화되어 정합 유지", consistent,
      { status: sessionAfter.status, issued: issueR.ok, inviteCount, transition: transitionR.ok });

    await prisma.workerInvite.deleteMany({ where: { pilotSessionId: s2.value.id } });
    await prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: s2.value.id } } });
    await prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: s2.value.id } });
    await prisma.traineeSupervision.deleteMany({ where: { pilotSessionId: s2.value.id } });
    await prisma.traineePlacement.deleteMany({ where: { pilotSessionId: s2.value.id } });
    await prisma.trainee.deleteMany({ where: { createdByPilotSessionId: s2.value.id } });
    await prisma.site.deleteMany({ where: { createdByPilotSessionId: s2.value.id } });
    await prisma.pilotSession.delete({ where: { id: s2.value.id } });

    // ── ⑦ 경합 매트릭스 ───────────────────────────────────────
    // 전이·발급·수락·연결·취소가 같은 회차 락을 잡으므로 어떤 순서로 커밋되든
    // **부분 데이터가 남지 않아야** 한다. 승자는 스케줄에 따라 달라질 수 있으므로
    // 판정은 "정합한 조합인가 + 진 쪽이 흔적을 남기지 않았는가"로 한다.
    console.log("\n[⑦] 경합 매트릭스 — 진 경로가 부분 데이터를 남기지 않음");

    /** 경합 검증용 회차를 통째로 만든다(참여자 1명 = 신규 Worker, 초대 발급까지). */
    async function makeRaceSession(tag: string, opts?: { withAcceptedPeer?: boolean }) {
      const s = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-01-01"), endDate: D("2027-01-31"),
        createdByAdminId: admin.id,
      });
      if (!s.ok) throw new Error(`${tag}: 회차 생성 실패`);
      const st = await createPilotSite({
        pilotSessionId: s.value.id, companyName: `${tag}사업체`, address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error(`${tag}: 사업체 실패`);
      const tr = await createPilotTrainee({
        pilotSessionId: s.value.id, siteId: st.value.id, name: `${tag}훈련생`,
        gender: "M", disabilityType: "지적", severity: "심하지않은",
      });
      if (!tr.ok) throw new Error(`${tag}: 훈련생 실패`);
      const p = await createPilotParticipant({
        pilotSessionId: s.value.id, siteId: st.value.id, workerId: null, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-01-01"), assignmentEndDate: D("2027-01-31"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      if (!p.ok) throw new Error(`${tag}: 참여자 실패`);

      // READY→ACTIVE가 "미응답 0"을 요구하므로, 필요하면 이미 수락한 동료를 하나 둔다.
      if (opts?.withAcceptedPeer) {
        const peerW = await prisma.worker.create({
          data: { loginId: `__ps4_peer_${tag}_${stamp}`, password: "x", workerName: "동료", phoneNumber: `0119${(stamp + tag.length) % 10000000}`, role: "WORKER", status: "ACTIVE" },
        });
        const peerTr = await createPilotTrainee({
          pilotSessionId: s.value.id, siteId: st.value.id, name: `${tag}훈련생P`,
          gender: "F", disabilityType: "지적", severity: "심하지않은",
        });
        if (!peerTr.ok) throw new Error(`${tag}: 동료 훈련생 실패`);
        const peerP = await createPilotParticipant({
          pilotSessionId: s.value.id, siteId: st.value.id, workerId: peerW.id, traineeIds: [peerTr.value.id],
          assignmentStartDate: D("2027-01-01"), assignmentEndDate: D("2027-01-31"),
          serviceStep: "FIELD_TRAINING", workType: "AM",
        });
        if (!peerP.ok) throw new Error(`${tag}: 동료 참여자 실패`);
        await transitionPilotSession(s.value.id, "READY");
        const peerInv = await issuePilotInvite({
          sessionId: s.value.id, participantId: peerP.value.participantId,
          phoneNumber: peerW.phoneNumber!, createdByAdminId: admin.id,
        });
        if (!peerInv.ok) throw new Error(`${tag}: 동료 발급 실패`);
        await connectExistingPilotInvite({ workerId: peerW.id, inviteId: peerInv.invite.id });
      } else {
        await transitionPilotSession(s.value.id, "READY");
      }

      const inv = await issuePilotInvite({
        sessionId: s.value.id, participantId: p.value.participantId,
        phoneNumber: `0120${(stamp + tag.length) % 10000000}`, createdByAdminId: admin.id,
      });
      if (!inv.ok) throw new Error(`${tag}: 발급 실패`);
      return { sessionId: s.value.id, participantId: p.value.participantId, inviteId: inv.invite.id, phone: inv.invite.phoneNumber };
    }

    async function cleanupRace(id: bigint) {
      await prisma.traineeSupervision.deleteMany({ where: { pilotSessionId: id } });
      await prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: id } } });
      await prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: id } });
      await prisma.workerInvite.deleteMany({ where: { pilotSessionId: id } });
      await prisma.siteAssignment.deleteMany({ where: { pilotSessionId: id } });
      await prisma.traineePlacement.deleteMany({ where: { pilotSessionId: id } });
      await prisma.trainee.deleteMany({ where: { createdByPilotSessionId: id } });
      await prisma.worker.deleteMany({ where: { createdByPilotSessionId: id } });
      await prisma.site.deleteMany({ where: { createdByPilotSessionId: id } });
      await prisma.pilotSession.delete({ where: { id } }).catch(() => {});
    }


    // ⑦-1 READY→ACTIVE vs 신규 Worker 수락
    {
      const r = await makeRaceSession("R1", { withAcceptedPeer: true });
      const [tr, ac] = await Promise.all([
        transitionPilotSession(r.sessionId, "ACTIVE"),
        acceptPilotInviteRace(r.inviteId, r.phone),
      ]);
      const s = await prisma.pilotSession.findUniqueOrThrow({ where: { id: r.sessionId } });
      const w = await prisma.worker.findUnique({ where: { loginId: r.phone } });
      const asg = await prisma.siteAssignment.count({ where: { pilotSessionId: r.sessionId } });
      // 정합 조합: (수락 성공 → Worker 존재) 또는 (수락 실패 → Worker 없음). 중간 상태는 없어야 한다.
      const consistent = ac.ok ? w != null : w == null;
      check("★전이 vs 신규 수락 — 진 쪽이 부분 데이터를 남기지 않음", consistent,
        { status: s.status, accept: ac.ok, worker: w != null, asg, transition: tr.ok });
      await cleanupRace(r.sessionId);
    }

    // ⑦-2 READY→ACTIVE vs 기존 Worker 연결
    {
      const s3 = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-02-01"), endDate: D("2027-02-28"),
        createdByAdminId: admin.id,
      });
      if (!s3.ok) throw new Error("R2 회차 실패");
      const st = await createPilotSite({
        pilotSessionId: s3.value.id, companyName: "R2사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error("R2 사업체 실패");
      const tr = await createPilotTrainee({
        pilotSessionId: s3.value.id, siteId: st.value.id, name: "R2훈련생",
        gender: "M", disabilityType: "지적", severity: "심하지않은",
      });
      if (!tr.ok) throw new Error("R2 훈련생 실패");
      const exW = await prisma.worker.create({
        data: { loginId: `__ps4_r2_${stamp}`, password: "x", workerName: "R2지도원", phoneNumber: `0121${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
      });
      const p = await createPilotParticipant({
        pilotSessionId: s3.value.id, siteId: st.value.id, workerId: exW.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-02-01"), assignmentEndDate: D("2027-02-28"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      if (!p.ok) throw new Error("R2 참여자 실패");
      await transitionPilotSession(s3.value.id, "READY");
      const inv = await issuePilotInvite({
        sessionId: s3.value.id, participantId: p.value.participantId,
        phoneNumber: exW.phoneNumber!, createdByAdminId: admin.id,
      });
      if (!inv.ok) throw new Error("R2 발급 실패");

      const [tr2, cn] = await Promise.all([
        transitionPilotSession(s3.value.id, "ACTIVE"),
        connectExistingPilotInvite({ workerId: exW.id, inviteId: inv.invite.id }),
      ]);
      const asg = await prisma.siteAssignment.findUniqueOrThrow({ where: { id: p.value.assignmentId! } });
      const invAfter = await prisma.workerInvite.findUniqueOrThrow({ where: { id: inv.invite.id } });
      const part = await prisma.pilotParticipant.findUniqueOrThrow({ where: { id: p.value.participantId } });
      // 연결 성공이면 배정·초대·참여자가 모두 진행, 실패면 모두 그대로.
      const consistent = cn.ok
        ? asg.connectedAt != null && invAfter.usedAt != null && part.status === "ACCEPTED"
        : asg.connectedAt == null && invAfter.usedAt == null && part.status === "INVITED";
      check("★전이 vs 기존 연결 — 배정·초대·참여자가 함께 움직이거나 함께 멈춤", consistent,
        { connect: cn.ok, connectedAt: asg.connectedAt != null, used: invAfter.usedAt != null, part: part.status, transition: tr2.ok });
      await cleanupRace(s3.value.id);
      await prisma.worker.delete({ where: { id: exW.id } }).catch(() => {});
    }

    // ⑦-3 참여자 취소 vs 초대 발급
    {
      const s4 = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-03-01"), endDate: D("2027-03-31"),
        createdByAdminId: admin.id,
      });
      if (!s4.ok) throw new Error("R3 회차 실패");
      const st = await createPilotSite({
        pilotSessionId: s4.value.id, companyName: "R3사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error("R3 사업체 실패");
      const tr = await createPilotTrainee({
        pilotSessionId: s4.value.id, siteId: st.value.id, name: "R3훈련생",
        gender: "F", disabilityType: "지적", severity: "심하지않은",
      });
      if (!tr.ok) throw new Error("R3 훈련생 실패");
      const p = await createPilotParticipant({
        pilotSessionId: s4.value.id, siteId: st.value.id, workerId: null, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-03-01"), assignmentEndDate: D("2027-03-31"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      if (!p.ok) throw new Error("R3 참여자 실패");
      await transitionPilotSession(s4.value.id, "READY");

      const [cancelR, issueR2] = await Promise.all([
        cancelPilotParticipant(p.value.participantId),
        issuePilotInvite({
          sessionId: s4.value.id, participantId: p.value.participantId,
          phoneNumber: `0122${stamp % 10000000}`, createdByAdminId: admin.id,
        }),
      ]);
      const part = await prisma.pilotParticipant.findUniqueOrThrow({ where: { id: p.value.participantId } });
      const invites = await prisma.workerInvite.findMany({ where: { pilotSessionId: s4.value.id } });
      // 발급이 이겼으면 초대 1건 + 취소가 그 초대를 무효화, 취소가 이겼으면 발급 거부 + 초대 0건.
      const consistent = issueR2.ok
        ? invites.length === 1 && (!cancelR.ok || part.status === "CANCELLED")
        : invites.length === 0 && part.status === "CANCELLED";
      check("★취소 vs 발급 — 고아 초대 없음", consistent,
        { issue: issueR2.ok, cancel: cancelR.ok, part: part.status, invites: invites.length });
      if (issueR2.ok && part.status === "CANCELLED") {
        check("취소가 뒤따랐으면 초대가 무효화됨", invites[0].expiresAt.getTime() < Date.now(), invites[0].expiresAt);
      }
      await cleanupRace(s4.value.id);
    }

    // ⑦-4 참여자 취소 vs 신규 수락
    {
      const r = await makeRaceSession("R4");
      const [cancelR, acceptR] = await Promise.all([
        cancelPilotParticipant(r.participantId),
        acceptPilotInviteRace(r.inviteId, r.phone),
      ]);
      const part = await prisma.pilotParticipant.findUniqueOrThrow({ where: { id: r.participantId } });
      const w = await prisma.worker.findUnique({ where: { loginId: r.phone } });
      // 수락이 이겼으면 ACCEPTED + Worker 존재 + 취소는 거부, 취소가 이겼으면 CANCELLED + Worker 없음.
      const consistent = acceptR.ok
        ? part.status === "ACCEPTED" && w != null && !cancelR.ok
        : part.status === "CANCELLED" && w == null;
      check("★취소 vs 신규 수락 — 계정 생성까지 함께 롤백", consistent,
        { accept: acceptR.ok, cancel: cancelR.ok, part: part.status, worker: w != null });
      await cleanupRace(r.sessionId);
    }

    // ⑦-5 참여자 취소 vs 기존 연결
    {
      const s5 = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-04-01"), endDate: D("2027-04-30"),
        createdByAdminId: admin.id,
      });
      if (!s5.ok) throw new Error("R5 회차 실패");
      const st = await createPilotSite({
        pilotSessionId: s5.value.id, companyName: "R5사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error("R5 사업체 실패");
      const tr = await createPilotTrainee({
        pilotSessionId: s5.value.id, siteId: st.value.id, name: "R5훈련생",
        gender: "M", disabilityType: "지적", severity: "심하지않은",
      });
      if (!tr.ok) throw new Error("R5 훈련생 실패");
      const exW = await prisma.worker.create({
        data: { loginId: `__ps4_r5_${stamp}`, password: "x", workerName: "R5지도원", phoneNumber: `0123${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
      });
      const p = await createPilotParticipant({
        pilotSessionId: s5.value.id, siteId: st.value.id, workerId: exW.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-04-01"), assignmentEndDate: D("2027-04-30"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      if (!p.ok) throw new Error("R5 참여자 실패");
      await transitionPilotSession(s5.value.id, "READY");
      const inv = await issuePilotInvite({
        sessionId: s5.value.id, participantId: p.value.participantId,
        phoneNumber: exW.phoneNumber!, createdByAdminId: admin.id,
      });
      if (!inv.ok) throw new Error("R5 발급 실패");

      const [cancelR, connectR] = await Promise.all([
        cancelPilotParticipant(p.value.participantId),
        connectExistingPilotInvite({ workerId: exW.id, inviteId: inv.invite.id }),
      ]);
      const part = await prisma.pilotParticipant.findUniqueOrThrow({ where: { id: p.value.participantId } });
      const asg = await prisma.siteAssignment.findUniqueOrThrow({ where: { id: p.value.assignmentId! } });
      const invAfter = await prisma.workerInvite.findUniqueOrThrow({ where: { id: inv.invite.id } });
      const consistent = connectR.ok
        ? part.status === "ACCEPTED" && asg.connectedAt != null && !cancelR.ok
        : part.status === "CANCELLED" && asg.connectedAt == null && invAfter.usedAt == null;
      check("★취소 vs 기존 연결 — 배정 활성화와 취소가 동시에 성립하지 않음", consistent,
        { connect: connectR.ok, cancel: cancelR.ok, part: part.status, connectedAt: asg.connectedAt != null });
      await cleanupRace(s5.value.id);
      await prisma.worker.delete({ where: { id: exW.id } }).catch(() => {});
    }

    // ⑦-6 전역 ACTIVE 1개가 경합 후에도 유지되는가
    {
      const remaining = await prisma.pilotSession.count({ where: { status: "ACTIVE" } });
      check("★경합 검증 후에도 전역 ACTIVE는 1개 이하", remaining <= 1, { remaining });
    }

    // ── ⑧ 리뷰 지적 회귀 테스트 ───────────────────────────────
    console.log("\n[⑧] 기존 배정 불변식·취소 정리·PURGED·기관 불변·동시 ACTIVE");

    // ⑧-1 기존 배정과 기간·슬롯이 겹치면 거부(정상 배정 경로와 같은 불변식)
    {
      const s = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-05-01"), endDate: D("2027-05-31"),
        createdByAdminId: admin.id,
      });
      if (!s.ok) throw new Error("R6 회차 실패");
      const st = await createPilotSite({
        pilotSessionId: s.value.id, companyName: "R6사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error("R6 사업체 실패");
      const tr = await createPilotTrainee({
        pilotSessionId: s.value.id, siteId: st.value.id, name: "R6훈련생",
        gender: "M", disabilityType: "지적", severity: "심하지않은",
      });
      if (!tr.ok) throw new Error("R6 훈련생 실패");

      const busyW = await prisma.worker.create({
        data: { loginId: `__ps4_busy_${stamp}`, password: "x", workerName: "바쁜지도원", phoneNumber: `0124${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
      });
      // 다른 현장에 이미 종일 배정이 있는 상태
      const otherBusySite = await prisma.site.create({
        data: { companyName: "__ps4_busy_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
      });
      await prisma.siteAssignment.create({
        data: {
          workerId: busyW.id, siteId: otherBusySite.id, agencyId: agency.id, status: "ACTIVE",
          startDate: D("2027-05-01"), endDate: D("2027-05-31"), workType: "FULL_DAY",
        },
      });

      const conflictRes = await createPilotParticipant({
        pilotSessionId: s.value.id, siteId: st.value.id, workerId: busyW.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-05-10"), assignmentEndDate: D("2027-05-20"),
        serviceStep: "FIELD_TRAINING", workType: "AM",
      });
      check("기존 점유 배정과 겹치면 거부(순차 — 검사 로직 확인)",
        conflictRes.ok === false && conflictRes.code === "ASSIGNMENT_CONFLICT", conflictRes);
      const leaked = await prisma.siteAssignment.count({ where: { workerId: busyW.id, pilotSessionId: s.value.id } });
      check("거부 시 파일럿 배정이 생기지 않음", leaked === 0);

      // ★실제 경합 — 정상 배정 생성과 파일럿 배정 생성을 동시에 실행한다.
      //  정상 경로는 withWorkerAssignmentLock(단일키) 안에서 시간충돌 검사 후 생성한다.
      //  파일럿 경로가 같은 lock space(acquireWorkerLock도 단일키)를 쓰지 않으면
      //  둘 다 "겹침 없음"을 관측하고 통과해 이중배정이 생긴다.
      {
        const raceW = await prisma.worker.create({
          data: { loginId: `__ps4_race_${stamp}`, password: "x", workerName: "경합지도원", phoneNumber: `0128${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
        });
        const normalSite = await prisma.site.create({
          data: { companyName: "__ps4_normal_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
        });
        const raceTr = await createPilotTrainee({
          pilotSessionId: s.value.id, siteId: st.value.id, name: "경합훈련생",
          gender: "F", disabilityType: "지적", severity: "심하지않은",
        });
        if (!raceTr.ok) throw new Error("경합 훈련생 실패");

        // 정상 배정 경로가 하는 일: 워커 락 → 시간충돌 검사 → 생성 (실제 helper 사용)
        const createNormalAssignment = () =>
          withWorkerAssignmentLock(raceW.id, async (tx) => {
            const existing = await tx.siteAssignment.findMany({
              where: { workerId: raceW.id, status: { in: [...OCCUPYING_STATUSES] } },
              select: { id: true, workType: true, customWorkStart: true, customWorkEnd: true, startDate: true, endDate: true },
            });
            const conflict = findTimeConflict(
              { workType: "FULL_DAY", startDate: D("2027-05-01"), endDate: D("2027-05-31") },
              existing,
            );
            if (conflict) return { created: false as const };
            await tx.siteAssignment.create({
              data: {
                workerId: raceW.id, siteId: normalSite.id, agencyId: agency.id, status: "ACTIVE",
                startDate: D("2027-05-01"), endDate: D("2027-05-31"), workType: "FULL_DAY",
              },
            });
            return { created: true as const };
          });

        const [normalR, pilotR] = await Promise.all([
          createNormalAssignment(),
          createPilotParticipant({
            pilotSessionId: s.value.id, siteId: st.value.id, workerId: raceW.id, traineeIds: [raceTr.value.id],
            assignmentStartDate: D("2027-05-01"), assignmentEndDate: D("2027-05-31"),
            serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
          }),
        ]);

        const occupying = await prisma.siteAssignment.count({
          where: { workerId: raceW.id, status: { in: [...OCCUPYING_STATUSES] } },
        });
        check("★정상 배정 vs 파일럿 배정 동시 생성 — 점유 배정이 1건만 남음",
          occupying === 1, { normal: normalR.created, pilot: pilotR.ok, occupying });
        check("★둘 중 정확히 하나만 성공(워커 락이 같은 lock space에서 직렬화)",
          [normalR.created, pilotR.ok].filter(Boolean).length === 1,
          { normal: normalR.created, pilot: pilotR.ok });

        await prisma.traineeSupervision.deleteMany({ where: { assignment: { workerId: raceW.id } } });
        await prisma.siteAssignment.deleteMany({ where: { workerId: raceW.id } });
        await prisma.site.delete({ where: { id: normalSite.id } });
        await prisma.worker.delete({ where: { id: raceW.id } });
      }

      // 비활성 Worker 거부
      const inactiveW = await prisma.worker.create({
        data: { loginId: `__ps4_inact_${stamp}`, password: "x", workerName: "휴면지도원", phoneNumber: `0125${stamp % 10000000}`, role: "WORKER", status: "PAUSED" },
      });
      const inactiveRes = await createPilotParticipant({
        pilotSessionId: s.value.id, siteId: st.value.id, workerId: inactiveW.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-05-01"), assignmentEndDate: D("2027-05-31"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      check("★비활성 Worker 배정 거부",
        inactiveRes.ok === false && inactiveRes.code === "WORKER_NOT_ACTIVE", inactiveRes);

      await prisma.siteAssignment.deleteMany({ where: { workerId: { in: [busyW.id, inactiveW.id] } } });
      await prisma.site.delete({ where: { id: otherBusySite.id } });
      await prisma.worker.deleteMany({ where: { id: { in: [busyW.id, inactiveW.id] } } });
      await cleanupRace(s.value.id);
    }

    // ⑧-2 기존 Worker 취소 시 배정 정원 해제 + 담당 관계 제거
    {
      const s = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-06-01"), endDate: D("2027-06-30"),
        createdByAdminId: admin.id,
      });
      if (!s.ok) throw new Error("R7 회차 실패");
      const st = await createPilotSite({
        pilotSessionId: s.value.id, companyName: "R7사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error("R7 사업체 실패");
      await prisma.site.update({ where: { id: st.value.id }, data: { fullDayCapacity: 1 } });
      const tr = await createPilotTrainee({
        pilotSessionId: s.value.id, siteId: st.value.id, name: "R7훈련생",
        gender: "F", disabilityType: "지적", severity: "심하지않은",
      });
      if (!tr.ok) throw new Error("R7 훈련생 실패");
      const w1 = await prisma.worker.create({
        data: { loginId: `__ps4_c1_${stamp}`, password: "x", workerName: "취소전지도원", phoneNumber: `0126${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
      });
      const w2 = await prisma.worker.create({
        data: { loginId: `__ps4_c2_${stamp}`, password: "x", workerName: "대체지도원", phoneNumber: `0127${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
      });

      const p1 = await createPilotParticipant({
        pilotSessionId: s.value.id, siteId: st.value.id, workerId: w1.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-06-01"), assignmentEndDate: D("2027-06-30"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      if (!p1.ok) throw new Error("R7 참여자1 실패");

      // 정원 1이라 대체 지도원은 지금은 못 들어간다
      const blocked = await createPilotParticipant({
        pilotSessionId: s.value.id, siteId: st.value.id, workerId: w2.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-06-01"), assignmentEndDate: D("2027-06-30"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      check("취소 전에는 정원·담당 중복으로 대체 지도원 불가", blocked.ok === false, blocked);

      const cancelRes = await cancelPilotParticipant(p1.value.participantId);
      check("기존 Worker 참여 취소 성공", cancelRes.ok === true, cancelRes);
      check("★취소가 배정 점유를 해제했다고 보고", cancelRes.ok === true && cancelRes.value.releasedAssignment === true);
      check("★취소가 담당 관계를 제거했다고 보고", cancelRes.ok === true && cancelRes.value.removedSupervisions === 1, cancelRes);

      const asgAfter = await prisma.siteAssignment.findUniqueOrThrow({ where: { id: p1.value.assignmentId! } });
      check("★배정이 DROPPED로 내려가 정원을 비움", asgAfter.status === "DROPPED", asgAfter.status);
      const supAfter = await prisma.traineeSupervision.count({ where: { assignmentId: p1.value.assignmentId! } });
      check("★담당 관계가 남지 않음(대체 담당자 차단 해소)", supAfter === 0);

      // 이제 대체 지도원이 들어갈 수 있어야 한다
      const replaced = await createPilotParticipant({
        pilotSessionId: s.value.id, siteId: st.value.id, workerId: w2.id, traineeIds: [tr.value.id],
        assignmentStartDate: D("2027-06-01"), assignmentEndDate: D("2027-06-30"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
      });
      check("★취소 후 대체 지도원 셋업 성공", replaced.ok === true, replaced);

      await prisma.traineeSupervision.deleteMany({ where: { pilotSessionId: s.value.id } });
      await prisma.siteAssignment.deleteMany({ where: { workerId: { in: [w1.id, w2.id] } } });
      await cleanupRace(s.value.id);
      await prisma.worker.deleteMany({ where: { id: { in: [w1.id, w2.id] } } });
    }

    // ⑧-3 폐기 작업 없이 PURGED 전환 거부
    {
      const s = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-07-01"), endDate: D("2027-07-31"),
        createdByAdminId: admin.id,
      });
      if (!s.ok) throw new Error("R8 회차 실패");
      await prisma.pilotSession.update({ where: { id: s.value.id }, data: { status: "ENDED" } });
      const purge = await transitionPilotSession(s.value.id, "PURGED");
      check("★ENDED→PURGED 전이 거부(폐기 서비스만 설정)",
        purge.ok === false && purge.code === "INVALID_TRANSITION", purge);
      const after = await prisma.pilotSession.findUniqueOrThrow({ where: { id: s.value.id } });
      check("상태가 ENDED로 유지됨", after.status === "ENDED");
      await prisma.pilotSession.delete({ where: { id: s.value.id } });
    }

    // ⑧-4 셋업 후 agencyId 변경 거부 — ★서비스 계층 검증(라우트 409는 4-B 스모크 대상).
    {
      const s = await createPilotSession({
        agencyId: agency.id, startDate: D("2027-08-01"), endDate: D("2027-08-31"),
        createdByAdminId: admin.id,
      });
      if (!s.ok) throw new Error("R9 회차 실패");
      // 셋업 자원을 만들어 "변경하면 발산이 생기는 상태"를 실제로 구성한다.
      const st = await createPilotSite({
        pilotSessionId: s.value.id, companyName: "R9사업체", address: "서울", gpsLat: 37.5, gpsLon: 127.0,
      });
      if (!st.ok) throw new Error("R9 사업체 실패");

      // ★검증 범위를 정확히 적는다: 여기서 확인하는 것은 **서비스 계층**이다.
      //  입력 타입에서 agencyId를 제외했으므로 캐스팅으로 밀어 넣어도 무시되어야 한다.
      //  라우트의 409 거부는 이 스크립트가 덮지 못한다(server-only 제약) — 4-B 스모크 대상.
      await updatePilotSession(s.value.id, { agencyId: otherAgency.id } as never);
      const after = await prisma.pilotSession.findUniqueOrThrow({ where: { id: s.value.id } });
      check("★서비스 입력 타입상 기관 변경 불가 — 런타임 추가 필드도 무시(발산 방지)",
        after.agencyId === agency.id, after.agencyId);

      // 정상 수정은 통과해야 한다 — 위 거부가 '아무것도 못 바꾸는' 과잉이 아님을 확인.
      const nameOk = await updatePilotSession(s.value.id, { managerDisplayName: "박위탁" });
      check("표시명 수정은 정상 통과(거부가 과잉이 아님)", nameOk.ok === true, nameOk);
      const after2 = await prisma.pilotSession.findUniqueOrThrow({ where: { id: s.value.id } });
      check("셋업 자원이 있어도 표시명은 바뀜", after2.managerDisplayName === "박위탁");

      await prisma.site.deleteMany({ where: { createdByPilotSessionId: s.value.id } });
      await prisma.pilotSession.delete({ where: { id: s.value.id } });
    }

    // ⑧-5 자격을 갖춘 READY 회차 2개의 동시 ACTIVE 전환
    {
      const a = await makeRaceSession("A1", { withAcceptedPeer: true });
      const b = await makeRaceSession("B1", { withAcceptedPeer: true });
      // 미응답 참여자를 정리해 양쪽 모두 ACTIVE 자격을 갖춘다.
      for (const r of [a, b]) {
        const pend = await prisma.pilotParticipant.findMany({
          where: { pilotSessionId: r.sessionId, status: { in: ["CONFIGURED", "INVITED"] } },
          select: { id: true },
        });
        for (const p of pend) await cancelPilotParticipant(p.id);
      }
      const [ra, rb] = await Promise.all([
        transitionPilotSession(a.sessionId, "ACTIVE"),
        transitionPilotSession(b.sessionId, "ACTIVE"),
      ]);
      const okCount = [ra, rb].filter((r) => r.ok).length;
      check("★자격 있는 두 회차 동시 ACTIVE — 정확히 1건만 성공", okCount === 1, { ra: ra.ok, rb: rb.ok });
      const loser = [ra, rb].find((r) => !r.ok);
      check("★진 쪽은 500이 아니라 ACTIVE_EXISTS 409",
        loser != null && !loser.ok && loser.code === "ACTIVE_EXISTS" && loser.status === 409, loser);
      const activeCount = await prisma.pilotSession.count({ where: { status: "ACTIVE" } });
      check("전역 ACTIVE 1개 유지", activeCount === 1, { activeCount });

      for (const r of [a, b]) {
        await prisma.pilotSession.update({ where: { id: r.sessionId }, data: { status: "ENDED" } }).catch(() => {});
        await cleanupRace(r.sessionId);
      }
    }
  } finally {
    console.log("\n[정리]");
    const c = new CleanupGuard();
    if (sessionId) {
      const sid = sessionId;
      await c.step("supervision", () => prisma.traineeSupervision.deleteMany({ where: { pilotSessionId: sid } }));
      await c.step("participantTrainee", () => prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: sid } } }));
      await c.step("participant", () => prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: sid } }));
      await c.step("invite", () => prisma.workerInvite.deleteMany({ where: { pilotSessionId: sid } }));
      await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { pilotSessionId: sid } }));
      await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { pilotSessionId: sid } }));
      await c.step("trainee", () => prisma.trainee.deleteMany({ where: { createdByPilotSessionId: sid } }));
      await c.step("site", () => prisma.site.deleteMany({ where: { createdByPilotSessionId: sid } }));
      await c.step("pilotSession", () => prisma.pilotSession.delete({ where: { id: sid } }));
    }
    await c.step("workers", () => prisma.worker.deleteMany({ where: { loginId: { startsWith: "__ps4_" } } }));
    await c.step("sites", () => prisma.site.deleteMany({ where: { agencyId: { in: [agency.id, otherAgency.id] } } }));
    await c.step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await c.step("agencies", () => prisma.agency.deleteMany({ where: { id: { in: [agency.id, otherAgency.id] } } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__ps4_"]);
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
