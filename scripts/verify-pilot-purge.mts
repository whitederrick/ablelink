// scripts/verify-pilot-purge.mts
// 5단계 검증 — 파일럿 초기화(§10). docs/PILOT_ROLLBACK_INSTRUCTION_2026_08_13.md
//
// ★이 검증의 1순위는 "지워졌는가"가 아니라 **"비파일럿이 살아 있는가"** 다.
//  초기화는 운영 DB에서 도는 파괴적 작업이라, 과잉 삭제가 누락보다 훨씬 위험하다.
//  그래서 외부 대조군(다른 기관의 기관·현장·훈련생·워커·감사·접속·API 기록)을 먼저 심고
//  삭제 후 **전량 생존**을 단언한다.
//
// ★거부(400/409)는 "메시지가 났다"로 통과시키지 않는다. 거부 후 **행이 그대로 살아 있는지**까지 확인한다.
// ★양성 대조를 함께 둔다 — 중단 사유를 없애면 실제로 통과하는지, 축이 과잉 삭제하지 않는지.
//
// 실행: npx tsx scripts/verify-pilot-purge.mts

import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";
import { CleanupGuard } from "./_cleanupGuard.mts";

// ★.mts(ESM) → lib/*.ts(CJS) 인터롭: tsx 에서 named export 가 감지되지 않는 리포 전역 조건.
import * as resNs from "../lib/pilot/resources";
type ResModule = typeof import("../lib/pilot/resources");
const R = (resNs as unknown as { default?: ResModule }).default ?? (resNs as unknown as ResModule);
import * as purgeNs from "../lib/pilot/purge";
type PurgeModule = typeof import("../lib/pilot/purge");
const P = (purgeNs as unknown as { default?: PurgeModule }).default ?? (purgeNs as unknown as PurgeModule);

assertWritableDb("파일럿 초기화 검증(테스트 자원 생성·삭제)");

const prisma = new PrismaClient();
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SIG_BUCKET = "signatures";

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectFail(label: string, code: string, fn: () => Promise<unknown>) {
  try { await fn(); ok(label, false, "거부되지 않음"); }
  catch (e) {
    const c = (e as { code?: string }).code;
    ok(label, c === code, `기대 ${code}, 실제 ${c ?? (e as Error).message}`);
  }
}

const STAMP = Date.now().toString(36);
// 1x1 투명 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const made = {
  pilotId: null as bigint | null,
  agencyId: null as bigint | null,
  extAgencyId: null as bigint | null,
  extSiteId: null as bigint | null,
  extTraineeId: null as bigint | null,
  extWorkerId: null as bigint | null,
  strayIds: [] as bigint[],
  storagePaths: [] as string[],
  // ★정리는 **생성 시 보관한 id로만** 한다. 이름 패턴·날짜 기반 삭제는 금지다(F16).
  auditIds: [] as bigint[],
  accessIds: [] as bigint[],
  evalIds: [] as bigint[],
  apiIds: [] as bigint[],
};

async function uploadObject(path: string) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SIG_BUCKET}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "image/png", "x-upsert": "true" },
    body: new Uint8Array(PNG),
  });
  if (!res.ok) throw new Error(`업로드 실패 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  made.storagePaths.push(path);
}
async function objectExists(path: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/info/${SIG_BUCKET}/${path}`, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return res.ok;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Storage 환경변수가 없어 검증할 수 없습니다.");

  // ─────────────────────────────────────────────────────────
  console.log("\n[0] 외부 대조군(비파일럿) 생성 — 삭제 후 전량 생존해야 한다");
  const ext = await prisma.agency.create({ data: { name: `대조기관-${STAMP}`, planType: "STANDARD", isActive: true } });
  made.extAgencyId = ext.id;
  const extSite = await prisma.site.create({
    data: { agencyId: ext.id, companyName: `대조사업체-${STAMP}`, address: "서울 어딘가", gpsLat: 37.5, gpsLon: 127.0, isVerified: false },
  });
  made.extSiteId = extSite.id;
  const extTrainee = await prisma.trainee.create({
    data: { name: `대조훈련생-${STAMP}`, gender: "남", disabilityType: "지적장애", severity: "경증", currentSiteId: extSite.id },
  });
  made.extTraineeId = extTrainee.id;
  const extWorker = await prisma.worker.create({
    data: { loginId: `ext${STAMP}`.slice(0, 20), password: "x", workerName: `대조워커-${STAMP}`, phoneNumber: "01000000000", planType: "FREE" },
  });
  made.extWorkerId = extWorker.id;
  ok("외부 기관·현장·훈련생·워커 생성", !!ext.id && !!extSite.id && !!extTrainee.id && !!extWorker.id);

  // ─────────────────────────────────────────────────────────
  console.log("\n[1] 파일럿 전용 자원 생성 (기존 3단계 서비스 그대로)");
  const p = await R.createPilot({ name: `초기화검증-${STAMP}`, agencyName: `초기화검증기관-${STAMP}`, note: "verify-purge" });
  made.pilotId = p.pilotId; made.agencyId = p.agencyId;
  const s1 = await R.createPilotSite(p.pilotId, {
    companyName: `검증사업체-${STAMP}`, address: "서울 중구 세종대로 110",
    gpsLat: "37.5663", gpsLon: "126.9779", businessContactName: "김담당",
  });
  const t1 = await R.createPilotTrainee(p.pilotId, {
    siteId: s1.id.toString(), name: "훈련생1", gender: "남", disabilityType: "지적장애", severity: "중증", startDate: "2026-08-01",
  });
  const w1 = await R.createPilotWorker(p.pilotId, { workerName: "지도원1", phoneNumber: "01099990001", password: "pilot1234!" });
  const g1 = await R.createPilotAssignment(p.pilotId, {
    workerId: w1.id.toString(), siteId: s1.id.toString(), workType: "FULL_DAY",
    startDate: "2026-08-01", endDate: "2026-08-31",
  });
  ok("파일럿 자원 6종 생성", !!p.pilotId && !!s1.id && !!t1.trainee.id && !!w1.id && !!g1.id);

  console.log("\n[2] 자식·파생 데이터 생성 (Cascade 대상 + 명시 삭제 대상)");
  const att = await prisma.dailyAttendance.create({
    data: { workerId: w1.id, siteId: s1.id, assignmentId: g1.id, workDate: "2026-08-03", status: "DONE" },
  });
  const log = await prisma.traineeLog.create({
    data: { attendanceId: att.id, traineeId: t1.trainee.id, writerId: w1.id, trainingType: "1on1", content: "검증" },
  });
  const editReq = await prisma.attendanceEditRequest.create({
    data: { attendanceId: att.id, workerId: w1.id, reason: "검증" },
  });
  const holiday = await prisma.siteHoliday.create({ data: { assignmentId: g1.id, date: "2026-08-15", reason: "검증" } });
  const token = await prisma.siteSignToken.create({
    data: {
      token: randomUUID(), docType: "attendance-sheet", assignmentId: g1.id,
      periodStart: "2026-08-01", periodEnd: "2026-08-31", signRole: "company_manager",
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const run = await prisma.documentRun.create({
    data: {
      agencyId: p.agencyId, assignmentId: g1.id, siteId: s1.id, workerId: w1.id,
      docType: "ATTENDANCE_SHEET", periodStart: new Date("2026-08-01"), periodEnd: new Date("2026-08-31"),
      openAt: new Date("2026-08-01"), dueAt: new Date("2026-09-05"),
    },
  });
  await prisma.documentVersion.create({ data: { runId: run.id, versionNo: 1, stage: "FINAL", pdfUrl: "" } });
  const sup = await prisma.traineeSupervision.create({
    data: { traineeId: t1.trainee.id, placementId: t1.placement.id, assignmentId: g1.id, startDate: new Date("2026-08-01") },
  });
  ok("근태·일지·수정요청·휴무·서명토큰·문서·담당 생성", !!att.id && !!log.id && !!editReq.id && !!holiday.id && !!token.id && !!run.id && !!sup.id);

  // ★TraineeEvaluation — OR 조건 증명용 4조합
  const evalBase = { evalType: "TRAINING", periodStart: "2026-08-01", periodEnd: "2026-08-31", scores: {} as object };
  const ev1 = await prisma.traineeEvaluation.create({ data: { ...evalBase, traineeId: t1.trainee.id, writerId: w1.id } });
  const ev2 = await prisma.traineeEvaluation.create({ data: { ...evalBase, traineeId: extTrainee.id, writerId: w1.id } });
  const ev3 = await prisma.traineeEvaluation.create({ data: { ...evalBase, traineeId: t1.trainee.id, writerId: extWorker.id } });
  const ev4 = await prisma.traineeEvaluation.create({ data: { ...evalBase, traineeId: extTrainee.id, writerId: extWorker.id } });
  made.evalIds.push(ev1.id, ev2.id, ev3.id, ev4.id);
  ok("평가 4조합 생성(파일럿×파일럿 / 외부훈련생×파일럿워커 / 파일럿훈련생×외부워커 / 외부×외부)", !!ev4.id);

  // WorkerInvite — createdByManagerId 가 required 라 외부 매니저를 빌린다(파일럿 기관엔 Manager 를 만들지 않는다)
  const anyManager = await prisma.manager.findFirst({ select: { id: true } });
  let inviteId: bigint | null = null;
  if (anyManager) {
    const inv = await prisma.workerInvite.create({
      data: {
        agencyId: p.agencyId, siteId: s1.id, phoneNumber: "01099990009", code: `VP${STAMP}`.slice(0, 10),
        expiresAt: new Date(Date.now() + 86_400_000), createdByManagerId: anyManager.id,
      },
    });
    inviteId = inv.id;
  }
  const announce = await prisma.agencyAnnouncement.create({
    data: { agencyId: p.agencyId, title: "검증", body: "검증" },
  });
  const api1 = await prisma.apiCallLog.create({ data: { agencyId: p.agencyId, workerId: w1.id, service: "GROQ_STT", success: true } });
  const apiExt = await prisma.apiCallLog.create({ data: { agencyId: ext.id, workerId: extWorker.id, service: "GROQ_STT", success: true } });
  made.apiIds.push(api1.id, apiExt.id);
  ok(`초대(${inviteId ? "생성" : "매니저 없어 건너뜀"})·공지·API기록 생성`, !!announce.id && !!api1.id && !!apiExt.id);

  // 감사·접속 기록 — 축별로 잡히는 것과 잡히면 안 되는 것
  const aeTarget = await prisma.auditEvent.create({
    data: { actorType: "ADMIN", entityType: "Worker", entityId: w1.id.toString(), action: "create", summary: "검증" },
  });
  const aeActor = await prisma.auditEvent.create({
    data: { actorType: "WORKER", actorId: w1.id, entityType: "TraineeLog", entityId: log.id.toString(), action: "create" },
  });
  const aeChild = await prisma.auditEvent.create({
    data: { actorType: "ADMIN", entityType: "DailyAttendance", entityId: att.id.toString(), action: "update" },
  });
  // ★양성 대조 — 같은 숫자 id 지만 entityType 이 다르다. entityId 단독 매칭이면 잘못 지워진다.
  const aeDecoy = await prisma.auditEvent.create({
    data: { actorType: "ADMIN", entityType: "PayrollRun", entityId: w1.id.toString(), action: "create" },
  });
  const aeExt = await prisma.auditEvent.create({
    data: { actorType: "ADMIN", entityType: "Worker", entityId: extWorker.id.toString(), action: "create" },
  });
  const alWorker = await prisma.accessLog.create({
    data: { actorType: "ADMIN", subjectType: "Worker", subjectId: w1.id.toString(), resource: "worker_detail", action: "view" },
  });
  const alRun = await prisma.accessLog.create({
    data: { actorType: "ADMIN", subjectType: "DocumentRun", subjectId: run.id.toString(), resource: "official_document", action: "view" },
  });
  const alSummary = await prisma.accessLog.create({
    data: { actorType: "ADMIN", subjectType: "Trainee", subjectId: null, subjectLabel: `현장 훈련생 목록 1명 ${STAMP}`, resource: "trainee_list", action: "view" },
  });
  const alDecoy = await prisma.accessLog.create({
    data: { actorType: "ADMIN", subjectType: "PayrollItem", subjectId: w1.id.toString(), resource: "payslip", action: "print" },
  });
  const alExt = await prisma.accessLog.create({
    data: { actorType: "ADMIN", subjectType: "Worker", subjectId: extWorker.id.toString(), resource: "worker_detail", action: "view" },
  });
  made.auditIds.push(aeTarget.id, aeActor.id, aeChild.id, aeDecoy.id, aeExt.id);
  made.accessIds.push(alWorker.id, alRun.id, alSummary.id, alDecoy.id, alExt.id);
  ok("감사 5행·접속 5행 생성(대상 3 + 양성대조 2 씩)", !!aeExt.id && !!alExt.id);

  console.log("\n[3] Storage 객체 — DB 참조 없는 고아 + 토큰 경로");
  // ★고아: 어떤 DB 행도 이 경로를 가리키지 않는다. prefix 나열이 아니면 못 찾는다.
  await uploadObject(`${w1.id}/signature_orphan_${STAMP}.png`);
  // ★토큰 경로: SiteSignToken 이 배정 Cascade 로 사라지면 근거가 없어진다(F20).
  const tokenPath = `sign-tokens/${token.token}/signature_${STAMP}.png`;
  await uploadObject(tokenPath);
  await prisma.siteSignToken.update({ where: { id: token.id }, data: { signatureUrl: tokenPath } });
  ok("서명 객체 2건 업로드(고아 1 + 토큰 1)", await objectExists(tokenPath));

  // ─────────────────────────────────────────────────────────
  console.log("\n[4] 미리보기 — 아무것도 지우지 않는다");
  const prev = await P.previewPilotPurge(p.pilotId);
  ok("레지스트리 집계 정확(기관1·현장1·훈련생1·재적1·워커1·배정1)",
    prev.registry.Agency === 1 && prev.registry.Site === 1 && prev.registry.Trainee === 1 &&
    prev.registry.TraineePlacement === 1 && prev.registry.Worker === 1 && prev.registry.SiteAssignment === 1,
    JSON.stringify(prev.registry));
  ok("Cascade 집계에 근태·일지·수정요청·문서·휴무·서명토큰 반영",
    prev.cascade.DailyAttendance === 1 && prev.cascade.TraineeLog === 1 && prev.cascade.AttendanceEditRequest === 1 &&
    prev.cascade.DocumentRun === 1 && prev.cascade.SiteHoliday === 1 && prev.cascade.SiteSignToken === 1,
    JSON.stringify(prev.cascade));
  ok("명시 삭제 대상에 평가 3건(OR 조합)", prev.explicit.TraineeEvaluation === 3, String(prev.explicit.TraineeEvaluation));
  ok("명시 삭제 대상에 담당 1·공지 1·API 1", prev.explicit.TraineeSupervision === 1 && prev.explicit.AgencyAnnouncement === 1 && prev.explicit.ApiCallLog === 1);
  ok("감사 3행·접속 2행이 축에 걸림(양성대조 4행은 제외)",
    prev.explicit.AuditEvent === 3 && prev.explicit.AccessLog === 2,
    `audit=${prev.explicit.AuditEvent} access=${prev.explicit.AccessLog}`);
  ok("Storage 2건 수집(고아 포함 — prefix 나열이 동작)", prev.storage.length === 2, JSON.stringify(prev.storage));
  ok("중단 사유 없음", prev.blockers.length === 0, JSON.stringify(prev.blockers));
  ok("미리보기는 삭제하지 않는다 — 배정 생존", (await prisma.siteAssignment.count({ where: { id: g1.id } })) === 1);
  ok("미리보기는 삭제하지 않는다 — 감사 5행 생존",
    (await prisma.auditEvent.count({ where: { id: { in: [aeTarget.id, aeActor.id, aeChild.id, aeDecoy.id, aeExt.id] } } })) === 5);

  // ─────────────────────────────────────────────────────────
  console.log("\n[5] 확인 문자열 불일치 → 거부 (행 생존까지 확인)");
  await expectFail("이름이 틀리면 400", "CONFIRM_MISMATCH", () => P.purgePilot(made.pilotId!, "틀린이름"));
  await expectFail("빈 값이면 400", "CONFIRM_MISMATCH", () => P.purgePilot(made.pilotId!, ""));
  ok("거부가 말뿐이 아님 — 파일럿 자원 전량 생존",
    (await prisma.agency.count({ where: { id: p.agencyId } })) === 1 &&
    (await prisma.siteAssignment.count({ where: { id: g1.id } })) === 1 &&
    (await prisma.worker.count({ where: { id: w1.id } })) === 1);

  // ─────────────────────────────────────────────────────────
  console.log("\n[6] 중단 사유(preflight) → 거부 + 양성 대조");
  const stray = await prisma.site.create({
    data: { agencyId: p.agencyId, companyName: `레지스트리밖-${STAMP}`, address: "x", gpsLat: 37.5, gpsLon: 127.0 },
  });
  made.strayIds.push(stray.id);
  const prevBlocked = await P.previewPilotPurge(p.pilotId);
  ok("레지스트리 밖 Site 가 중단 사유로 잡힘",
    prevBlocked.blockers.some((b) => b.label.includes("레지스트리 밖 Site")), JSON.stringify(prevBlocked.blockers));
  await expectFail("중단 사유가 있으면 실행 거부(409)", "PURGE_BLOCKED", () => P.purgePilot(made.pilotId!, prev.pilot.name));
  ok("거부 후에도 자원 생존", (await prisma.siteAssignment.count({ where: { id: g1.id } })) === 1);

  const group = await prisma.noticeGroup.create({ data: { agencyId: p.agencyId, name: `검증그룹-${STAMP}` } });
  const prevBlocked2 = await P.previewPilotPurge(p.pilotId);
  ok("설계 위반(NoticeGroup)도 중단 사유로 잡힘", prevBlocked2.blockers.some((b) => b.label === "NoticeGroup"));
  await prisma.noticeGroup.delete({ where: { id: group.id } });

  // ★Agency 필수 FK(RESTRICT) 14종 중 유일하게 빠져 있던 모델. 미리보기가 통과하고 실제 삭제가
  //  원문 FK 오류로 터지던 자리다(외부 리뷰 지적 P2-3).
  const clause = await prisma.agencyContractClause.create({
    data: { agencyId: p.agencyId, title: `검증특약-${STAMP}`, body: "검증" },
  });
  const prevBlocked3 = await P.previewPilotPurge(p.pilotId);
  ok("AgencyContractClause 가 중단 사유로 잡힘",
    prevBlocked3.blockers.some((b) => b.label === "AgencyContractClause"), JSON.stringify(prevBlocked3.blockers));
  await expectFail("특약이 있으면 실행 거부(409) — FK 오류로 터지지 않는다", "PURGE_BLOCKED",
    () => P.purgePilot(made.pilotId!, prev.pilot.name));
  ok("거부 후 자원 생존", (await prisma.agency.count({ where: { id: p.agencyId } })) === 1);
  await prisma.agencyContractClause.delete({ where: { id: clause.id } });

  await prisma.site.delete({ where: { id: stray.id } });
  made.strayIds = [];
  const prevClear = await P.previewPilotPurge(p.pilotId);
  ok("★양성 대조 — 중단 사유를 없애면 다시 0건", prevClear.blockers.length === 0, JSON.stringify(prevClear.blockers));

  // ─────────────────────────────────────────────────────────
  console.log("\n[7] 부분완료(재시도 대기) 상태에서는 계정 생성 차단");
  const anyRes = await prisma.pilotResource.findFirst({ where: { pilotId: p.pilotId, kind: "WORKER" }, select: { id: true } });
  await prisma.pilotResource.update({ where: { id: anyRes!.id }, data: { deleteError: "검증용 강제 실패" } });
  await expectFail("deleteError 가 남아 있으면 워커 생성 409", "PURGE_PENDING",
    () => R.createPilotWorker(made.pilotId!, { workerName: "지도원2", phoneNumber: "01099990002", password: "pilot1234!" }));
  ok("차단이 말뿐이 아님 — 계정이 만들어지지 않음",
    (await prisma.worker.count({ where: { loginId: "01099990002" } })) === 0);
  await prisma.pilotResource.update({ where: { id: anyRes!.id }, data: { deleteError: null } });

  // ─────────────────────────────────────────────────────────
  // ─────────────────────────────────────────────────────────
  // ★★여기부터가 실패 경로다. 이전 검증(52/52)은 정상 경로만 태워서
  //  "실패 → 보존 → 재시도" 가 한 번도 실행되지 않은 채 통과했다.
  console.log("\n[8] ★Storage 삭제 실패 주입 — 보존과 재시도 목록이 실제로 남는가");
  const failing = { deleteObject: async () => ({ ok: false as const, error: "주입된 실패(검증)" }) };
  const failed = await P.purgePilot(p.pilotId, prev.pilot.name, failing);
  ok("완료로 보고하지 않는다(completed=false)", failed.completed === false);
  ok("Storage 2건 전부 실패로 집계", failed.storage.total === 2 && failed.storage.deleted === 0 && failed.storage.failed.length === 2,
    JSON.stringify(failed.storage));
  ok("DB 자원은 이미 삭제됨(트랜잭션은 커밋됐다)",
    (await prisma.agency.count({ where: { id: p.agencyId } })) === 0 &&
    (await prisma.siteAssignment.count({ where: { id: g1.id } })) === 0);
  ok("★Pilot·레지스트리는 보존 — 지우면 재시도 목록을 잃는다",
    (await prisma.pilot.count({ where: { id: p.pilotId } })) === 1 &&
    (await prisma.pilotResource.count({ where: { pilotId: p.pilotId } })) > 0);
  ok("★deleteError 가 실제로 기록됨(재시도 목록)",
    (await prisma.pilotResource.count({ where: { pilotId: p.pilotId, deleteError: { not: null } } })) === 2);
  ok("★잔여를 0으로 위장하지 않는다 — Pilot·PilotResource 실제 건수 보고",
    failed.leftovers.Pilot === 1 && failed.leftovers.PilotResource > 0, JSON.stringify(failed.leftovers));
  ok("★retained 로 '보존'과 '소멸'을 구분해 보고", failed.retained !== null && failed.retained.pilot === 1);
  ok("자원·기록 잔여는 0(보존 대상 2종 제외)",
    Object.entries(failed.leftovers).every(([k, v]) => v === 0 || k === "Pilot" || k === "PilotResource"),
    JSON.stringify(failed.leftovers));
  ok("삭제 건수 보고(평가 3·담당 1·API 1·감사 3·접속 2)",
    failed.deleted.TraineeEvaluation === 3 && failed.deleted.TraineeSupervision === 1 &&
    failed.deleted.ApiCallLog === 1 && failed.deleted.AuditEvent === 3 && failed.deleted.AccessLog === 2,
    JSON.stringify(failed.deleted));

  console.log("\n[8-1] ★초기화 창에서 새 자원 생성 차단 (기관은 사라졌고 Pilot 은 살아 있는 구간)");
  // ★이 상태에서는 기관이 이미 사라졌으므로 `PURGE_IN_PROGRESS` 축이 먼저 걸린다.
  //  (기관이 살아 있는 `deleteError` 단독 상태 = `PURGE_PENDING` 은 [7]이 덮는다.)
  await expectFail("초기화가 시작된 파일럿에는 계정을 만들 수 없다", "PURGE_IN_PROGRESS",
    () => R.createPilotWorker(made.pilotId!, { workerName: "창테스트", phoneNumber: "01099990003", password: "pilot1234!" }));
  // ★★deleteError 를 지워 **P1-1 의 실제 창**을 재현한다 — deleteError 는 Storage 실패 '이후'에야
  //  기록되므로, DB 삭제 직후~첫 실패 사이에는 0이다. 그 구간을 기관 실물 확인이 막아야 한다.
  await prisma.pilotResource.updateMany({ where: { pilotId: p.pilotId }, data: { deleteError: null } });
  await expectFail("★deleteError 가 0이어도 기관 실물이 없으면 409(PURGE_IN_PROGRESS)", "PURGE_IN_PROGRESS",
    () => R.createPilotWorker(made.pilotId!, { workerName: "창테스트", phoneNumber: "01099990003", password: "pilot1234!" }));
  ok("차단이 말뿐이 아님 — 계정이 만들어지지 않음",
    (await prisma.worker.count({ where: { loginId: "01099990003" } })) === 0);
  // 재시도 목록을 원상복구(위 updateMany 가 지운 사유를 되돌린다)
  await prisma.pilotResource.updateMany({
    where: { pilotId: p.pilotId, kind: "STORAGE_OBJECT" }, data: { deleteError: "주입된 실패(검증)" },
  });

  // ★보존 단언을 먼저 — 과잉 삭제가 누락보다 위험하다.
  console.log("\n[9] ★보존 단언 — 비파일럿은 전량 살아 있어야 한다");
  ok("외부 기관 생존", (await prisma.agency.count({ where: { id: ext.id } })) === 1);
  ok("외부 현장 생존", (await prisma.site.count({ where: { id: extSite.id } })) === 1);
  ok("외부 훈련생 생존", (await prisma.trainee.count({ where: { id: extTrainee.id } })) === 1);
  ok("외부 워커 생존", (await prisma.worker.count({ where: { id: extWorker.id } })) === 1);
  ok("외부×외부 평가 생존(EV4)", (await prisma.traineeEvaluation.count({ where: { id: ev4.id } })) === 1);
  ok("외부 API 기록 생존", (await prisma.apiCallLog.count({ where: { id: apiExt.id } })) === 1);
  ok("★entityType 이 다른 동일 id 감사행 생존(PayrollRun) — entityId 단독 매칭이 아님",
    (await prisma.auditEvent.count({ where: { id: aeDecoy.id } })) === 1);
  ok("외부 워커 감사행 생존", (await prisma.auditEvent.count({ where: { id: aeExt.id } })) === 1);
  ok("★subjectType 이 다른 동일 id 접속행 생존(PayrollItem)",
    (await prisma.accessLog.count({ where: { id: alDecoy.id } })) === 1);
  ok("외부 워커 접속행 생존", (await prisma.accessLog.count({ where: { id: alExt.id } })) === 1);
  ok("★subjectId=null 요약 접속행 생존(문서화된 예외 §10-2-1)",
    (await prisma.accessLog.count({ where: { id: alSummary.id } })) === 1);

  console.log("\n[10] 삭제 단언 — 파일럿 귀속은 전량 소멸");
  ok("기관·현장·훈련생·재적·워커·배정 0",
    (await prisma.agency.count({ where: { id: p.agencyId } })) === 0 &&
    (await prisma.site.count({ where: { id: s1.id } })) === 0 &&
    (await prisma.trainee.count({ where: { id: t1.trainee.id } })) === 0 &&
    (await prisma.traineePlacement.count({ where: { id: t1.placement.id } })) === 0 &&
    (await prisma.worker.count({ where: { id: w1.id } })) === 0 &&
    (await prisma.siteAssignment.count({ where: { id: g1.id } })) === 0);
  ok("Cascade 자식 소멸(근태·일지·수정요청·문서·버전·휴무·서명토큰)",
    (await prisma.dailyAttendance.count({ where: { id: att.id } })) === 0 &&
    (await prisma.traineeLog.count({ where: { id: log.id } })) === 0 &&
    (await prisma.attendanceEditRequest.count({ where: { id: editReq.id } })) === 0 &&
    (await prisma.documentRun.count({ where: { id: run.id } })) === 0 &&
    (await prisma.documentVersion.count({ where: { runId: run.id } })) === 0 &&
    (await prisma.siteHoliday.count({ where: { id: holiday.id } })) === 0 &&
    (await prisma.siteSignToken.count({ where: { id: token.id } })) === 0);
  ok("담당(TraineeSupervision) 소멸", (await prisma.traineeSupervision.count({ where: { id: sup.id } })) === 0);
  ok("★평가 OR 3조합 전부 소멸(EV1·EV2·EV3)",
    (await prisma.traineeEvaluation.count({ where: { id: { in: [ev1.id, ev2.id, ev3.id] } } })) === 0);
  ok("공지·API·감사 3행·접속 2행 소멸",
    (await prisma.agencyAnnouncement.count({ where: { id: announce.id } })) === 0 &&
    (await prisma.apiCallLog.count({ where: { id: api1.id } })) === 0 &&
    (await prisma.auditEvent.count({ where: { id: { in: [aeTarget.id, aeActor.id, aeChild.id] } } })) === 0 &&
    (await prisma.accessLog.count({ where: { id: { in: [alWorker.id, alRun.id] } } })) === 0);
  if (inviteId) ok("초대 소멸", (await prisma.workerInvite.count({ where: { id: inviteId } })) === 0);
  ok("실패했으므로 Pilot·PilotResource 는 아직 살아 있다",
    (await prisma.pilot.count({ where: { id: p.pilotId } })) === 1);

  // ─────────────────────────────────────────────────────────
  console.log("\n[11] ★★재시도 — 레지스트리가 실제 재시도 입력으로 쓰이는가");
  // ★★이 케이스가 P1-2 의 회귀 테스트다. 1차 실행에서 SiteSignToken 이 배정 Cascade 로 사라졌으므로
  //  `sign-tokens/{token}/` 은 **prefix 나열로는 절대 다시 못 찾는다**. 레지스트리(STORAGE_OBJECT)를
  //  합집합하지 않으면 지울 게 없다고 판단해 실패 기록까지 지우고 "완료" 로 보고한다.
  ok("근거 소멸 확인 — SiteSignToken 은 이미 없다(prefix 나열 불가)",
    (await prisma.siteSignToken.count({ where: { id: token.id } })) === 0);
  const retryPrev = await P.previewPilotPurge(p.pilotId);
  ok("★재시도 미리보기가 토큰 경로를 되찾음(레지스트리 복원)",
    retryPrev.storage.includes(tokenPath), JSON.stringify(retryPrev.storage));
  ok("이전 실행의 실패분이 재시도 대상으로 표시됨", retryPrev.retryPending === 2, String(retryPrev.retryPending));

  const retry = await P.purgePilot(p.pilotId, prev.pilot.name);
  ok("재시도 완료(completed)", retry.completed === true, JSON.stringify(retry.storage));
  ok("★재시도가 2건 모두 삭제(토큰 경로 포함)",
    retry.storage.total === 2 && retry.storage.deleted === 2 && retry.storage.failed.length === 0,
    JSON.stringify(retry.storage));
  ok("재시도 후 잔여 전량 0", Object.values(retry.leftovers).every((v) => v === 0), JSON.stringify(retry.leftovers));
  ok("retained 는 null(보존할 것이 없다)", retry.retained === null);
  ok("Pilot·PilotResource 소멸",
    (await prisma.pilot.count({ where: { id: p.pilotId } })) === 0 &&
    (await prisma.pilotResource.count({ where: { pilotId: p.pilotId } })) === 0);

  console.log("\n[12] Storage 실물 확인");
  const stillThere: string[] = [];
  for (const path of made.storagePaths) if (await objectExists(path)) stillThere.push(path);
  ok("★업로드한 서명 객체 2건이 실제로 사라짐(고아 + 토큰 경로)", stillThere.length === 0, stillThere.join(", "));
  made.storagePaths = stillThere;

  console.log("\n[13] 재실행 멱등 — 이미 사라진 파일럿");
  await expectFail("삭제된 파일럿 재초기화는 404", "PILOT_NOT_FOUND", () => P.purgePilot(made.pilotId!, prev.pilot.name));
  made.pilotId = null; made.agencyId = null;

  // ─────────────────────────────────────────────────────────
  console.log("\n[14] ★초기화와 자원 생성의 경쟁 — 고아가 남지 않는가");
  // ★단언은 "어느 쪽이 이기는가" 가 아니라 **불변식**이다: 계정이 만들어졌다면 반드시 함께 지워지고,
  //  못 만들었다면 존재하지 않는다. 어느 인터리빙에서도 추적 불가능한 계정이 남으면 안 된다.
  const p2 = await R.createPilot({ name: `경쟁검증-${STAMP}`, agencyName: `경쟁검증기관-${STAMP}` });
  made.pilotId = p2.pilotId; made.agencyId = p2.agencyId;
  const racePhone = "01099990004";
  const [racePurge, raceCreate] = await Promise.allSettled([
    P.purgePilot(p2.pilotId, `경쟁검증-${STAMP}`),
    R.createPilotWorker(p2.pilotId, { workerName: "경쟁", phoneNumber: racePhone, password: "pilot1234!" }),
  ]);
  const purgeOutcome = racePurge.status === "fulfilled"
    ? (racePurge.value.completed ? "완료" : "부분실패")
    : `거부(${(racePurge.reason as { code?: string })?.code ?? "?"})`;
  const createOutcome = raceCreate.status === "fulfilled"
    ? "생성됨" : `거부(${(raceCreate.reason as { code?: string })?.code ?? "?"})`;
  console.log(`     인터리빙: 초기화=${purgeOutcome} · 생성=${createOutcome}`);

  // ★불변식 ①: 계정이 만들어졌다면 **레지스트리에 기록돼 있거나 이미 삭제됐다**. 어느 쪽도 아니면 고아다.
  if (raceCreate.status === "fulfilled") {
    const wid = (raceCreate.value as { id: bigint }).id;
    const alive = await prisma.worker.count({ where: { id: wid } });
    const tracked = await prisma.pilotResource.count({ where: { kind: "WORKER", resourceKey: wid.toString() } });
    ok("★생성된 계정은 삭제됐거나 레지스트리로 추적 가능하다", alive === 0 || tracked === 1,
      `alive=${alive} tracked=${tracked}`);
  }

  // 초기화가 안전하게 중단됐다면(자원이 늘어 SCOPE_CHANGED) 재시도로 마무리한다 — 그것이 설계된 동선이다.
  if ((await prisma.pilot.count({ where: { id: p2.pilotId } })) === 1) {
    const fin = await P.purgePilot(p2.pilotId, `경쟁검증-${STAMP}`);
    ok("남은 자원은 재시도로 정리된다", fin.completed === true, JSON.stringify(fin.leftovers));
  }

  // ★불변식 ②: 어느 인터리빙에서도 최종 상태에 추적 불가능한 계정이 없다.
  ok("★고아 계정이 남지 않는다", (await prisma.worker.count({ where: { loginId: racePhone } })) === 0);
  ok("파일럿·레지스트리도 남지 않는다",
    (await prisma.pilot.count({ where: { id: p2.pilotId } })) === 0 &&
    (await prisma.pilotResource.count({ where: { pilotId: p2.pilotId } })) === 0);
  made.pilotId = null; made.agencyId = null;
}

// ★정리는 성공 경로에서만 도는 코드가 아니어야 한다 — finally 에서 null-safe 로 돈다.
async function cleanup() {
  console.log("\n[정리]");
  const c = new CleanupGuard();

  for (const path of made.storagePaths) {
    await c.step(`storage:${path}`, async () => {
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SIG_BUCKET}/${path}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${SERVICE_KEY}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    });
  }
  if (made.strayIds.length) {
    await c.step("stray-site", () => prisma.site.deleteMany({ where: { id: { in: made.strayIds } } }));
  }

  // 초기화가 중간에 실패했을 때만 남는다 — 레지스트리 기준으로 되짚어 지운다.
  if (made.pilotId) {
    const pid = made.pilotId;
    const rows = await prisma.pilotResource.findMany({ where: { pilotId: pid }, select: { kind: true, resourceKey: true } });
    const of = (k: string) => rows.filter((r) => r.kind === k).map((r) => BigInt(r.resourceKey));
    await c.step("noticeGroup", () => prisma.noticeGroup.deleteMany({ where: { agencyId: made.agencyId ?? BigInt(-1) } }));
    await c.step("evaluation", () => prisma.traineeEvaluation.deleteMany({
      where: { OR: [{ traineeId: { in: of("TRAINEE") } }, { writerId: { in: of("WORKER") } }] },
    }));
    await c.step("supervision", () => prisma.traineeSupervision.deleteMany({ where: { assignmentId: { in: of("ASSIGNMENT") } } }));
    await c.step("invite", () => prisma.workerInvite.deleteMany({ where: { agencyId: made.agencyId ?? BigInt(-1) } }));
    await c.step("announcement", () => prisma.agencyAnnouncement.deleteMany({ where: { agencyId: made.agencyId ?? BigInt(-1) } }));
    await c.step("apiCallLog", () => prisma.apiCallLog.deleteMany({ where: { workerId: { in: of("WORKER") } } }));
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { id: { in: of("ASSIGNMENT") } } }));
    await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { id: { in: of("PLACEMENT") } } }));
    await c.step("trainee", () => prisma.trainee.deleteMany({ where: { id: { in: of("TRAINEE") } } }));
    await c.step("worker", () => prisma.worker.deleteMany({ where: { id: { in: of("WORKER") } } }));
    await c.step("site", () => prisma.site.deleteMany({ where: { id: { in: of("SITE") } } }));
    if (made.agencyId) await c.step("agency", () => prisma.agency.deleteMany({ where: { id: made.agencyId! } }));
    await c.step("audit", () => prisma.auditEvent.deleteMany({
      where: { OR: [{ entityType: "Pilot", entityId: pid.toString() }, { entityType: "Worker", entityId: { in: of("WORKER").map(String) } }] },
    }));
    await c.step("pilot", () => prisma.pilot.deleteMany({ where: { id: pid } }));
  }

  // 외부 대조군 — 검증이 끝나면 지운다(파일럿과 무관하므로 초기화 대상이 아니었다).
  // ★전부 **생성 시 보관한 id로만** 지운다. 남은 것이 있어도 이름·날짜로 훑지 않는다.
  await c.step("test-evaluation", () => prisma.traineeEvaluation.deleteMany({ where: { id: { in: made.evalIds } } }));
  await c.step("test-audit", () => prisma.auditEvent.deleteMany({ where: { id: { in: made.auditIds } } }));
  await c.step("test-access", () => prisma.accessLog.deleteMany({ where: { id: { in: made.accessIds } } }));
  await c.step("test-apiCallLog", () => prisma.apiCallLog.deleteMany({ where: { id: { in: made.apiIds } } }));
  if (made.extWorkerId) await c.step("ext-worker", () => prisma.worker.deleteMany({ where: { id: made.extWorkerId! } }));
  if (made.extTraineeId) await c.step("ext-trainee", () => prisma.trainee.deleteMany({ where: { id: made.extTraineeId! } }));
  if (made.extSiteId) await c.step("ext-site", () => prisma.site.deleteMany({ where: { id: made.extSiteId! } }));
  if (made.extAgencyId) await c.step("ext-agency", () => prisma.agency.deleteMany({ where: { id: made.extAgencyId! } }));

  const left = c.report();
  ok("테스트 데이터 정리 완료(잔여 0)", left === 0, `정리 실패 ${left}건`);

  // ★"정리 완료" 출력만 믿지 않는다 — 조회로 재확인한다.
  const leftovers = {
    pilots: made.pilotId ? await prisma.pilot.count({ where: { id: made.pilotId } }) : 0,
    extAgency: made.extAgencyId ? await prisma.agency.count({ where: { id: made.extAgencyId } }) : 0,
    extWorker: made.extWorkerId ? await prisma.worker.count({ where: { id: made.extWorkerId } }) : 0,
    stale: await new CleanupGuard().assertNoStale(prisma as never, ["초기화검증기관-", "대조기관-"]),
  };
  ok(`잔여 재조회 0 (${JSON.stringify(leftovers)})`, Object.values(leftovers).every((v) => v === 0));
}

main()
  .catch((e) => { fail++; console.error("\n⛔ 예외:", e instanceof Error ? e.stack : e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("정리 중 예외:", e));
    console.log(`\n=== 결과: ${pass} passed, ${fail} failed ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
