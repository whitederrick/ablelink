// scripts/verify-pilot-accept.mts
// 파일럿 초대 수락 트랜잭션 검증 — v1.8 §12 3단계.
// 실행: npx tsx scripts/verify-pilot-accept.mts
//
// 3단계의 핵심은 1·2단계가 깔아 놓은 것을 제대로 쓰는가다. 네 접합부를 본다:
//   ① 락 획득 순서 [site] → worker → trainee
//   ② READY 상태 검사가 트랜잭션 안에서 이뤄지는가
//   ③ createdAssignmentId 멱등
//   ④ 실패 시 Worker 생성까지 전체 롤백
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
import * as acceptNs from "../lib/pilot/acceptInvite";
import * as issueNs from "../lib/pilot/issueInvite";
import * as connectNs from "../lib/pilot/connectInvite";

// ★.mts(ESM) → lib/*.ts(CJS) 인터롭: tsx에서 named export가 감지되지 않아 default로 꺼낸다.
function interop<T>(ns: unknown): T {
  return (ns as { default?: T }).default ?? (ns as T);
}
const { acceptPilotInvite } = interop<typeof import("../lib/pilot/acceptInvite")>(acceptNs);
const { issuePilotInvite } = interop<typeof import("../lib/pilot/issueInvite")>(issueNs);
const { connectExistingPilotInvite } = interop<typeof import("../lib/pilot/connectInvite")>(connectNs);

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}
const D = (s: string) => new Date(s + "T00:00:00Z");

async function main() {
  await assertWritableDb();
  const stamp = Date.now();

  const agency = await prisma.agency.create({ data: { name: `__pa_${stamp}` } });
  const admin = await prisma.admin.create({
    data: { loginId: `__pa_adm_${stamp}`, passwordHash: "x", displayName: "운영자" },
  });
  const site = await prisma.site.create({
    data: { companyName: "__pa_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id, fullDayCapacity: 2 },
  });
  const t1 = await prisma.trainee.create({
    data: { name: "__pa_t1", gender: "M", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
  });
  const t2 = await prisma.trainee.create({
    data: { name: "__pa_t2", gender: "F", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
  });
  // 담당 훈련생의 재적 — 배정 기간과 겹쳐야 수락이 통과한다.
  for (const t of [t1, t2]) {
    await prisma.traineePlacement.create({
      data: { traineeId: t.id, siteId: site.id, startDate: D("2026-09-01"), endDate: D("2026-09-30") },
    });
  }

  const session = await prisma.pilotSession.create({
    data: {
      agencyId: agency.id, createdByAdminId: admin.id,
      startDate: D("2026-09-01"), endDate: D("2026-09-30"), status: "DRAFT",
    },
  });

  const mkInvite = async (phone: string) =>
    prisma.workerInvite.create({
      data: {
        agencyId: agency.id, phoneNumber: phone, code: String(100000 + Math.floor(Math.random() * 899999)),
        expiresAt: D("2026-12-31"), createdByAdminId: admin.id, pilotSessionId: session.id,
      },
    });

  const mkParticipant = async (inviteId: bigint, traineeIds: bigint[], workType = "FULL_DAY") =>
    prisma.pilotParticipant.create({
      data: {
        pilotSessionId: session.id, siteId: site.id, inviteId, status: "INVITED",
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType,
        trainees: { create: traineeIds.map((id) => ({ traineeId: id })) },
      },
    });

  const newWorker = (phone: string, name: string) => ({
    loginId: phone, phoneNumber: phone, workerName: name, passwordHash: "hashed",
    consentTermsAt: new Date(), consentPrivacyAt: new Date(), consentLocationAt: null,
  });

  try {
    // ── ② READY 검사 ────────────────────────────────────────────
    console.log("\n[②] 수락 창구 — READY에서만");
    const invA = await mkInvite(`0101${stamp % 10000000}`);
    const pA = await mkParticipant(invA.id, [t1.id]);

    const draftTry = await acceptPilotInvite({ inviteId: invA.id, newWorker: newWorker(invA.phoneNumber, "지도원A") });
    check("★DRAFT 회차에서는 수락 거부",
      draftTry.ok === false && draftTry.code === "SESSION_NOT_READY", draftTry);

    const workerAfterDraft = await prisma.worker.findUnique({ where: { loginId: invA.phoneNumber } });
    check("★거부 시 Worker가 생성되지 않음(전체 롤백)", workerAfterDraft == null);

    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "READY" } });

    // ── ① 정상 수락 ─────────────────────────────────────────────
    console.log("\n[①] 정상 수락 — Worker+배정+담당+참여자 한 트랜잭션");
    const okA = await acceptPilotInvite({ inviteId: invA.id, newWorker: newWorker(invA.phoneNumber, "지도원A") });
    check("수락 성공", okA.ok === true, okA);

    if (okA.ok) {
      const asg = await prisma.siteAssignment.findUnique({ where: { id: okA.assignmentId } });
      check("배정이 회차에 귀속됨", asg?.pilotSessionId === session.id);
      check("★배정 기간이 참여자 설정값(now가 아님)",
        asg?.startDate.toISOString().slice(0, 10) === "2026-09-01", asg?.startDate);
      check("★근무형태가 참여자 설정값(FULL_DAY 기본값 아님)", asg?.workType === "FULL_DAY");
      check("근태 설정이 파일럿 기준(NONE·면제)",
        asg?.attendanceMode === "NONE" && asg?.attendanceButtonExempt === true);
      check("배정 기관이 회차의 실재 위탁기관", asg?.agencyId === agency.id);

      const sups = await prisma.traineeSupervision.findMany({ where: { assignmentId: okA.assignmentId } });
      check("담당 관계 생성됨", sups.length === 1, { n: sups.length });
      check("★담당 관계에도 회차 기록", sups[0]?.pilotSessionId === session.id);

      const w = await prisma.worker.findUnique({ where: { id: okA.workerId } });
      check("★신규 Worker에 생성 출처 기록(폐기 정책용)", w?.createdByPilotSessionId === session.id);

      const p = await prisma.pilotParticipant.findUnique({ where: { id: pA.id } });
      check("참여자 ACCEPTED + 배정 id 기록",
        p?.status === "ACCEPTED" && p?.createdAssignmentId === okA.assignmentId);
    }

    // ── ③ 멱등 ──────────────────────────────────────────────────
    console.log("\n[③] 재수락 멱등");
    const again = await acceptPilotInvite({ inviteId: invA.id, newWorker: newWorker(invA.phoneNumber, "지도원A") });
    check("재수락도 성공으로 반환", again.ok === true, again);
    check("★alreadyAccepted 표시", again.ok === true && again.alreadyAccepted === true);
    if (okA.ok && again.ok) {
      check("★같은 배정 id 반환(중복 생성 없음)", again.assignmentId === okA.assignmentId);
    }
    const asgCount = await prisma.siteAssignment.count({ where: { pilotSessionId: session.id } });
    check("배정이 1건만 존재", asgCount === 1, { asgCount });

    // ── 다수 훈련생 담당 (1:多) ────────────────────────────────
    console.log("\n[다수 훈련생] 한 지도원이 2명 담당");
    const invB = await mkInvite(`0102${stamp % 10000000}`);
    await mkParticipant(invB.id, [t1.id, t2.id]);
    const okB = await acceptPilotInvite({ inviteId: invB.id, newWorker: newWorker(invB.phoneNumber, "지도원B") });
    // t1은 이미 지도원A가 같은 기간 담당 중 → 담당 중복으로 거부되어야 한다
    check("★이미 담당 중인 훈련생이 섞이면 거부(담당 중복)",
      okB.ok === false && okB.code === "SUPERVISION_REJECTED", okB);
    const wB = await prisma.worker.findUnique({ where: { loginId: invB.phoneNumber } });
    check("★거부 시 Worker 생성까지 롤백", wB == null);

    // t2만 담당하면 통과
    const invC = await mkInvite(`0103${stamp % 10000000}`);
    await mkParticipant(invC.id, [t2.id]);
    const okC = await acceptPilotInvite({ inviteId: invC.id, newWorker: newWorker(invC.phoneNumber, "지도원C") });
    check("다른 훈련생만 담당하면 수락 성공(1:多 아님·별개 지도원)", okC.ok === true, okC);

    // ── ④ 재적 드리프트 ────────────────────────────────────────
    // 정원이 아니라 드리프트로 거부되는지 보려면 정원 여유를 먼저 확보한다.
    await prisma.site.update({ where: { id: site.id }, data: { fullDayCapacity: 10 } });
    console.log("\n[④] 설정↔실데이터 드리프트");
    const t3 = await prisma.trainee.create({
      data: { name: "__pa_t3", gender: "M", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
    });
    const invD = await mkInvite(`0104${stamp % 10000000}`);
    await mkParticipant(invD.id, [t3.id]); // t3에는 재적이 없다
    const okD = await acceptPilotInvite({ inviteId: invD.id, newWorker: newWorker(invD.phoneNumber, "지도원D") });
    check("★재적 없는 훈련생이 담당에 걸리면 거부",
      okD.ok === false && okD.code === "PLACEMENT_MISSING", okD);
    const wD = await prisma.worker.findUnique({ where: { loginId: invD.phoneNumber } });
    check("★거부 시 Worker 생성까지 롤백", wD == null);

    // ── 정원 ────────────────────────────────────────────────────
    console.log("\n[정원] 현장 정원 초과 차단");
    // 이미 A·C 2건이 찼으므로 정원을 2로 되돌리면 다음 수락은 초과다.
    await prisma.site.update({ where: { id: site.id }, data: { fullDayCapacity: 2 } });
    const t4 = await prisma.trainee.create({
      data: { name: "__pa_t4", gender: "F", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
    });
    await prisma.traineePlacement.create({
      data: { traineeId: t4.id, siteId: site.id, startDate: D("2026-09-01"), endDate: D("2026-09-30") },
    });
    const invE = await mkInvite(`0105${stamp % 10000000}`);
    await mkParticipant(invE.id, [t4.id]);
    const okE = await acceptPilotInvite({ inviteId: invE.id, newWorker: newWorker(invE.phoneNumber, "지도원E") });
    check("★정원 초과 시 거부(현장 락 안에서 검사)",
      okE.ok === false && okE.code === "CAPACITY_EXCEEDED", okE);
    const wE = await prisma.worker.findUnique({ where: { loginId: invE.phoneNumber } });
    check("★거부 시 Worker 생성까지 롤백", wE == null);

    // ── 동시 수락 ──────────────────────────────────────────────
    console.log("\n[동시성] 같은 초대 2회 동시 수락");
    await prisma.site.update({ where: { id: site.id }, data: { fullDayCapacity: 10 } });
    const t5 = await prisma.trainee.create({
      data: { name: "__pa_t5", gender: "M", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
    });
    await prisma.traineePlacement.create({
      data: { traineeId: t5.id, siteId: site.id, startDate: D("2026-09-01"), endDate: D("2026-09-30") },
    });
    const invF = await mkInvite(`0106${stamp % 10000000}`);
    await mkParticipant(invF.id, [t5.id]);
    const both = await Promise.all([
      acceptPilotInvite({ inviteId: invF.id, newWorker: newWorker(invF.phoneNumber, "지도원F") }),
      acceptPilotInvite({ inviteId: invF.id, newWorker: newWorker(invF.phoneNumber, "지도원F") }),
    ]);
    const okBoth = both.filter((r) => r.ok).length;
    const asgIds = new Set(both.filter((r) => r.ok).map((r) => (r as { assignmentId: bigint }).assignmentId.toString()));
    check("★동시 수락에도 배정은 1건만 생성", asgIds.size <= 1, { okBoth, asgIds: [...asgIds] });
    const fCount = await prisma.siteAssignment.count({ where: { workerId: { not: undefined }, pilotSessionId: session.id } });
    check("회차 배정 총계가 예상과 일치(A·C·F = 3)", fCount === 3, { fCount });
    // ── 기존 Worker 경로 ────────────────────────────────────────
    // 운영자가 배정을 먼저 만들고(§5.1) 초대에 assignmentId를 실어야 연결 API가 통과한다.
    console.log("\n[기존 Worker] 발급 시 배정 연결 + 연결 API 통과");
    const exWorker = await prisma.worker.create({
      data: { loginId: `__pa_ex_${stamp}`, password: "x", workerName: "기존지도원", phoneNumber: `0107${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
    });
    const t6 = await prisma.trainee.create({
      data: { name: "__pa_t6", gender: "M", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
    });
    await prisma.traineePlacement.create({
      data: { traineeId: t6.id, siteId: site.id, startDate: D("2026-09-01"), endDate: D("2026-09-30") },
    });
    const exAsg = await prisma.siteAssignment.create({
      data: {
        workerId: exWorker.id, siteId: site.id, agencyId: agency.id, status: "CONFIRMED",
        startDate: D("2026-09-01"), endDate: D("2026-09-30"), workType: "FULL_DAY",
        attendanceButtonExempt: true, pilotSessionId: session.id,
      },
    });
    const exParticipant = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: session.id, siteId: site.id, workerId: exWorker.id,
        createdAssignmentId: exAsg.id, status: "CONFIGURED",
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "FULL_DAY",
        trainees: { create: [{ traineeId: t6.id }] },
      },
    });

    // ★실서비스 호출 — 라우트 로직을 재현하지 않는다(재현 테스트는 실코드 회귀를 못 잡는다).
    const issued = await issuePilotInvite({
      sessionId: session.id, participantId: exParticipant.id,
      phoneNumber: exWorker.phoneNumber!, createdByAdminId: admin.id,
    });
    check("기존 Worker 초대 발급 성공", issued.ok === true, issued);
    if (!issued.ok) throw new Error("발급 실패로 이후 검증 불가");
    check("★기존 Worker 초대에 assignmentId가 실림(422 방지)", issued.invite.assignmentId === exAsg.id);

    const exPartInvited = await prisma.pilotParticipant.findUnique({ where: { id: exParticipant.id } });
    check("★참여자가 INVITED로 연결됨(CAS)", exPartInvited?.inviteId === issued.invite.id && exPartInvited?.status === "INVITED");

    // 배정 없는 기존 Worker는 발급 자체가 거부되어야 한다(막다른 초대 방지)
    const noAsgWorker = await prisma.worker.create({
      data: { loginId: `__pa_na_${stamp}`, password: "x", workerName: "배정없음", phoneNumber: `0109${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
    });
    const noAsgPart = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: session.id, siteId: site.id, workerId: noAsgWorker.id, status: "CONFIGURED",
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "AM",
      },
    });
    const noAsgIssue = await issuePilotInvite({
      sessionId: session.id, participantId: noAsgPart.id,
      phoneNumber: noAsgWorker.phoneNumber!, createdByAdminId: admin.id,
    });
    check("★배정 없는 기존 Worker는 발급 거부(막다른 초대 방지)",
      noAsgIssue.ok === false && noAsgIssue.code === "ASSIGNMENT_REQUIRED", noAsgIssue);

    // 연결 — 실서비스 호출
    const connected = await connectExistingPilotInvite({ workerId: exWorker.id, inviteId: issued.invite.id });
    check("★기존 Worker 연결 성공(422 없음)", connected.ok === true, connected);

    const exAfter = await prisma.siteAssignment.findUnique({ where: { id: exAsg.id } });
    const exPartAfter = await prisma.pilotParticipant.findUnique({ where: { id: exParticipant.id } });
    const exInviteAfter = await prisma.workerInvite.findUnique({ where: { id: issued.invite.id } });
    check("연결 후 배정 ACTIVE 전이", exAfter?.status === "ACTIVE");
    check("연결 후 connectedAt 기록", exAfter?.connectedAt != null);
    check("★참여자 ACCEPTED 전환(신규 경로와 대응)", exPartAfter?.status === "ACCEPTED");
    check("초대 사용 처리", exInviteAfter?.usedAt != null);

    // ── ★F1 — 취소된 참여자는 배정·초대가 전혀 바뀌지 않아야 한다 ──
    console.log("\n[F1] 취소된 참여자 연결 시 부분 커밋 없음");
    const cxWorker = await prisma.worker.create({
      data: { loginId: `__pa_cx_${stamp}`, password: "x", workerName: "취소대상", phoneNumber: `0110${stamp % 10000000}`, role: "WORKER", status: "ACTIVE" },
    });
    const cxAsg = await prisma.siteAssignment.create({
      data: {
        workerId: cxWorker.id, siteId: site.id, agencyId: agency.id, status: "CONFIRMED",
        startDate: D("2026-09-01"), endDate: D("2026-09-30"), workType: "AM",
        attendanceButtonExempt: true, pilotSessionId: session.id,
      },
    });
    const cxPart = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: session.id, siteId: site.id, workerId: cxWorker.id,
        createdAssignmentId: cxAsg.id, status: "CONFIGURED",
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "AM",
      },
    });
    const cxIssued = await issuePilotInvite({
      sessionId: session.id, participantId: cxPart.id,
      phoneNumber: cxWorker.phoneNumber!, createdByAdminId: admin.id,
    });
    if (!cxIssued.ok) throw new Error("취소 검증용 발급 실패");

    // 운영자가 참여를 취소한 뒤 워커가 연결을 시도
    await prisma.pilotParticipant.update({ where: { id: cxPart.id }, data: { status: "CANCELLED" } });
    const cxConnect = await connectExistingPilotInvite({ workerId: cxWorker.id, inviteId: cxIssued.invite.id });
    check("★취소된 참여자 연결 거부",
      cxConnect.ok === false && cxConnect.code === "PARTICIPANT_NOT_READY", cxConnect);

    const cxAsgAfter = await prisma.siteAssignment.findUnique({ where: { id: cxAsg.id } });
    const cxInviteAfter = await prisma.workerInvite.findUnique({ where: { id: cxIssued.invite.id } });
    check("★거부 시 배정이 전혀 변경되지 않음(connectedAt null·CONFIRMED 유지)",
      cxAsgAfter?.connectedAt == null && cxAsgAfter?.status === "CONFIRMED", cxAsgAfter);
    check("★거부 시 초대도 사용되지 않음", cxInviteAfter?.usedAt == null);

    // 회차가 READY가 아니면 연결 거부 + 무변경
    await prisma.pilotParticipant.update({ where: { id: cxPart.id }, data: { status: "INVITED" } });
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "DRAFT" } });
    const cxClosed = await connectExistingPilotInvite({ workerId: cxWorker.id, inviteId: cxIssued.invite.id });
    check("★회차가 READY 아니면 연결 거부",
      cxClosed.ok === false && cxClosed.code === "SESSION_NOT_READY", cxClosed);
    const cxAsg2 = await prisma.siteAssignment.findUnique({ where: { id: cxAsg.id } });
    check("★거부 시 배정 무변경", cxAsg2?.connectedAt == null && cxAsg2?.status === "CONFIRMED");
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "READY" } });

    // ── 동시 발급 ──────────────────────────────────────────────
    console.log("\n[동시 발급] 같은 참여자에 초대 2건 동시 발급");
    const t7 = await prisma.trainee.create({
      data: { name: "__pa_t7", gender: "F", disabilityType: "지적", severity: "심하지않은", currentSiteId: site.id },
    });
    const raceParticipant = await prisma.pilotParticipant.create({
      data: {
        pilotSessionId: session.id, siteId: site.id, status: "CONFIGURED",
        assignmentStartDate: D("2026-09-01"), assignmentEndDate: D("2026-09-30"),
        serviceStep: "FIELD_TRAINING", workType: "AM",
        trainees: { create: [{ traineeId: t7.id }] },
      },
    });

    // ★실서비스 동시 호출
    const issueOnce = (code: string) =>
      issuePilotInvite({
        sessionId: session.id, participantId: raceParticipant.id,
        phoneNumber: `0108${stamp % 10000000}`, createdByAdminId: admin.id,
        generateCode: () => code,
      });

    const raced = await Promise.all([issueOnce("111111"), issueOnce("222222")]);
    const okIssued = raced.filter((r) => r.ok).length;
    check("★동시 발급 2건 중 정확히 1건만 성공", okIssued === 1, raced);
    check("진 쪽은 ALREADY_INVITED로 거부",
      raced.some((r) => !r.ok && r.code === "ALREADY_INVITED"), raced);

    const orphans = await prisma.workerInvite.count({
      where: { pilotSessionId: session.id, code: { in: ["111111", "222222"] } },
    });
    check("★고아 초대 없음(진 쪽은 롤백되어 초대가 남지 않음)", orphans === 1, { orphans });
  } finally {
    console.log("\n[정리]");
    const c = new CleanupGuard();
    await c.step("supervision", () => prisma.traineeSupervision.deleteMany({ where: { pilotSessionId: session.id } }));
    await c.step("participantTrainee", () => prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: session.id } } }));
    await c.step("participant", () => prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: session.id } }));
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { pilotSessionId: session.id } }));
    await c.step("invite", () => prisma.workerInvite.deleteMany({ where: { pilotSessionId: session.id } }));
    await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { siteId: site.id } }));
    await c.step("trainee", () => prisma.trainee.deleteMany({ where: { currentSiteId: site.id } }));
    await c.step("pilotWorkers", () => prisma.worker.deleteMany({ where: { createdByPilotSessionId: session.id } }));
    await c.step("workers", () => prisma.worker.deleteMany({ where: { loginId: { startsWith: "__pa_" } } }));
    await c.step("pilotSession", () => prisma.pilotSession.delete({ where: { id: session.id } }));
    await c.step("site", () => prisma.site.delete({ where: { id: site.id } }));
    await c.step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await c.step("agency", () => prisma.agency.delete({ where: { id: agency.id } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__pa_"]);
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
