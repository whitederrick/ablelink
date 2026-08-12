// scripts/smoke-pilot-admin-api.mts
// 파일럿 운영자 API 라우트 계층 스모크 — v1.8 §12 4단계(4-B).
// 실행: dev 서버(localhost:3000)를 띄운 뒤  npx tsx scripts/smoke-pilot-admin-api.mts
//
// ★이 스크립트가 덮는 것은 verify-pilot-setup.mts가 못 덮는 **라우트 계층**이다:
//   인증(401) · 입력 검증(400) · 상태 위반(409) · audit 기록 · 응답 형태.
//   (verify-*는 서비스 함수를 직접 호출하므로 라우트를 태우지 않는다.)
//
// 5개 라우트 각각 성공 1건 + 대표 거부 1건을 실제 HTTP로 확인한다.
//
// ⚠️ 파괴적(테스트 데이터 생성·삭제) — assertWritableDb()로 운영 DB를 차단한다.
//    외부 SMS는 발송하지 않는다(초대 발급 API는 코드만 만들고 전송하지 않는다).
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
import * as adminSessionNs from "../lib/adminSession";

function interop<T>(ns: unknown): T {
  return (ns as { default?: T }).default ?? (ns as T);
}
const { signAdminSessionToken, ADMIN_SESSION_COOKIE_NAME } =
  interop<typeof import("../lib/adminSession")>(adminSessionNs);

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra ?? ""); }
}

let cookie = "";
async function api(method: string, path: string, body?: unknown, opts?: { noAuth?: boolean }) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts?.noAuth ? {} : { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json: json as Record<string, unknown> };
}

async function main() {
  await assertWritableDb();
  const stamp = Date.now();

  // dev 서버 확인
  try {
    const ping = await fetch(`${BASE}/admin/login`);
    if (!ping.ok) throw new Error(String(ping.status));
  } catch (e) {
    console.error(`dev 서버(${BASE})에 연결할 수 없습니다. \`npm run dev\` 후 다시 실행하세요.`, e);
    process.exit(1);
  }

  const agency = await prisma.agency.create({ data: { name: `__sm_${stamp}` } });
  const otherAgency = await prisma.agency.create({ data: { name: `__sm_other_${stamp}` } });
  const otherAgencyId = otherAgency.id.toString();
  const admin = await prisma.admin.create({
    data: { loginId: `__sm_adm_${stamp}`, passwordHash: "x", displayName: "스모크운영자" },
  });
  const token = await signAdminSessionToken({ sub: admin.id.toString(), loginId: admin.loginId, sv: 0 });
  cookie = `${ADMIN_SESSION_COOKIE_NAME}=${token}`;

  let sessionId = "";
  try {
    // ── 1. POST /api/admin/pilots ───────────────────────────────
    console.log("\n[1] 회차 생성 API");
    const noAuth = await api("POST", "/api/admin/pilots", {}, { noAuth: true });
    check("★인증 없으면 401", noAuth.status === 401, noAuth);

    const badInput = await api("POST", "/api/admin/pilots", {
      agencyId: agency.id.toString(), startDate: "2027-13-99", endDate: "2027-09-30",
    });
    check("★잘못된 날짜 형식 400", badInput.status === 400, badInput);
    check("400에 사람이 읽을 메시지 포함", typeof badInput.json.message === "string" && (badInput.json.message as string).length > 0);

    const created = await api("POST", "/api/admin/pilots", {
      agencyId: agency.id.toString(), startDate: "2027-09-01", endDate: "2027-09-30",
    });
    check("회차 생성 200", created.status === 200 && created.json.success === true, created);
    sessionId = String(created.json.id ?? "");
    check("생성 응답에 id", sessionId !== "");

    const list = await api("GET", "/api/admin/pilots");
    check("목록 조회 200", list.status === 200 && Array.isArray(list.json.items), list.status);
    const badStatus = await api("GET", "/api/admin/pilots?status=NOPE");
    check("★알 수 없는 status 필터 400(500 아님)", badStatus.status === 400, badStatus);

    // ── 1-2. 선택지 전용 경량 API ───────────────────────────────
    // ★목록 API(system/agencies·system/workers)를 드롭다운에 쓰지 않는다.
    //  그쪽은 플랜·직종·배정·현장을 중첩해 내려주므로 선택지용으로 PII가 과다 전송된다.
    console.log("\n[1-2] 선택지 전용 경량 API");
    const optAgencies = await api("GET", "/api/admin/pilots/options?kind=agencies");
    check("기관 선택지 200", optAgencies.status === 200 && Array.isArray(optAgencies.json.agencies), optAgencies.status);
    const firstAgency = (optAgencies.json.agencies as Record<string, unknown>[] | undefined)?.[0];
    check("★기관 선택지는 id·name만 반환(과다 필드 없음)",
      firstAgency != null && Object.keys(firstAgency).sort().join(",") === "id,name", firstAgency);

    const optNoQ = await api("GET", "/api/admin/pilots/options?kind=workers");
    check("★검색어 없으면 워커를 내려주지 않음(PII 최소 노출)",
      optNoQ.status === 200 && (optNoQ.json.workers as unknown[]).length === 0 && optNoQ.json.needsQuery === true, optNoQ);

    const optBadKind = await api("GET", "/api/admin/pilots/options?kind=nope");
    check("알 수 없는 kind 400", optBadKind.status === 400, optBadKind);

    const optNoAuth = await api("GET", "/api/admin/pilots/options?kind=agencies", undefined, { noAuth: true });
    check("★선택지 API도 인증 없으면 401", optNoAuth.status === 401, optNoAuth.status);

    // ── 1-3. 주소 검색(사업체 등록 전제) ────────────────────────
    // ★화면의 "주소 검색"이 실제로 이 경로를 태운다. 지도만 여는 구현이 아니다.
    console.log("\n[1-3] 주소 검색 API");
    const addrNoQ = await api("GET", "/api/geo/search-address");
    check("검색어 없으면 400", addrNoQ.status === 400, addrNoQ.status);
    const addrOk = await api("GET", "/api/geo/search-address?q=" + encodeURIComponent("서울 중구 세종대로 110"));
    check("주소 검색 200", addrOk.status === 200, addrOk.status);
    const addrDocs = (addrOk.json.items ?? addrOk.json.documents) as Record<string, unknown>[] | undefined;
    check("★검색 결과에 좌표(x·y) 포함 — 지도 초기 위치의 근거",
      Array.isArray(addrDocs) && addrDocs.length > 0 && addrDocs[0].x != null && addrDocs[0].y != null,
      addrDocs?.[0]);

    // ── 2. POST .../resources (site) ────────────────────────────
    console.log("\n[2] 사업체·훈련생 생성 API");
    const noCoord = await api("POST", "/api/admin/sites", {
      companyName: "스모크사업체", address: "서울",
      businessContactName: "김사업", businessContactPhone: "01011112222",
      agencyId: agency.id.toString(), pilotSessionId: sessionId,
    });
    check("좌표 없으면 거부", noCoord.status >= 400, noCoord.status);

    // ★사업체는 기존 현장 등록 경로(/api/admin/sites)를 그대로 쓴다.
    //  파일럿 전용 폼을 따로 만들지 않기 위해 화면도 admin/sites/new로 보낸다.
    const siteRes = await api("POST", "/api/admin/sites", {
      companyName: "스모크사업체", address: "서울시 성동구",
      gpsLat: "37.5", gpsLon: "127.0",
      businessContactName: "김사업", businessContactPhone: "01011112222",
      agencyId: agency.id.toString(),
      pilotSessionId: sessionId,
    });
    check("★기존 현장 등록 경로로 사업체 생성 200", siteRes.status === 200 && siteRes.json.success === true, siteRes);
    // /api/admin/sites는 생성 결과를 item으로 반환한다(파일럿 전용 응답 형태를 만들지 않는다).
    const siteId = String((siteRes.json.item as Record<string, unknown> | undefined)?.id ?? "");
    check("사업체 id 반환", siteId !== "", siteRes.json);

    // 회차와 기관이 어긋나면 거부되어야 한다(귀속 발산 방지).
    const crossAgency = await api("POST", "/api/admin/sites", {
      companyName: "잘못된기관", address: "서울", gpsLat: "37.5", gpsLon: "127.0",
      businessContactName: "김사업", businessContactPhone: "01011112222",
      agencyId: otherAgencyId, pilotSessionId: sessionId,
    });
    check("★회차 기관과 다른 기관이면 409", crossAgency.status === 409 && crossAgency.json.reason === "AGENCY_MISMATCH", crossAgency);

    const badKind = await api("POST", `/api/admin/pilots/${sessionId}/resources`, { kind: "unknown" });
    check("★알 수 없는 kind 400", badKind.status === 400, badKind);

    const traineeRes = await api("POST", `/api/admin/pilots/${sessionId}/resources`, {
      kind: "trainee", siteId, name: "스모크훈련생", gender: "M",
      disabilityType: "지적", severity: "심하지 않은",
    });
    check("훈련생 생성 200", traineeRes.status === 200 && traineeRes.json.success === true, traineeRes);
    const traineeId = String((traineeRes.json.trainee as Record<string, unknown> | undefined)?.id ?? "");

    // ── 3. POST .../participants ────────────────────────────────
    console.log("\n[3] 참여자 추가 API");
    const noTrainee = await api("POST", `/api/admin/pilots/${sessionId}/participants`, {
      siteId, traineeIds: [], assignmentStartDate: "2027-09-01", assignmentEndDate: "2027-09-30",
      workType: "FULL_DAY", serviceStep: "FIELD_TRAINING",
    });
    check("★담당 훈련생 0명이면 400", noTrainee.status === 400, noTrainee);

    const outOfPeriod = await api("POST", `/api/admin/pilots/${sessionId}/participants`, {
      siteId, traineeIds: [traineeId], assignmentStartDate: "2027-08-01", assignmentEndDate: "2027-09-30",
      workType: "FULL_DAY", serviceStep: "FIELD_TRAINING",
    });
    check("★회차 기간 밖이면 400 + 사유 노출",
      outOfPeriod.status === 400 && outOfPeriod.json.reason === "OUT_OF_SESSION_PERIOD", outOfPeriod);

    const partRes = await api("POST", `/api/admin/pilots/${sessionId}/participants`, {
      siteId, traineeIds: [traineeId], assignmentStartDate: "2027-09-01", assignmentEndDate: "2027-09-30",
      workType: "FULL_DAY", serviceStep: "FIELD_TRAINING",
    });
    check("신규 Worker 참여자 추가 200", partRes.status === 200 && partRes.json.success === true, partRes);
    const participantId = String(partRes.json.participantId ?? "");

    // ── 4. POST .../invites ─────────────────────────────────────
    console.log("\n[4] 초대 발급 API (외부 발송 없음)");
    const badPhone = await api("POST", `/api/admin/pilots/${sessionId}/invites`, {
      participantId, phoneNumber: "123",
    });
    check("★잘못된 전화번호 400", badPhone.status === 400, badPhone);

    const inviteRes = await api("POST", `/api/admin/pilots/${sessionId}/invites`, {
      participantId, phoneNumber: "01055556666", workerName: "스모크지도원",
    });
    check("초대 발급 200", inviteRes.status === 200 && inviteRes.json.success === true, inviteRes);
    const invite = inviteRes.json.invite as Record<string, unknown> | undefined;
    check("초대 코드 6자리 반환", typeof invite?.code === "string" && (invite.code as string).length === 6, invite);

    const dupInvite = await api("POST", `/api/admin/pilots/${sessionId}/invites`, {
      participantId, phoneNumber: "01055556666",
    });
    check("★중복 발급 409 + 사유", dupInvite.status === 409 && dupInvite.json.reason === "ALREADY_INVITED", dupInvite);

    // ── 5. PATCH /api/admin/pilots/[sessionId] ──────────────────
    console.log("\n[5] 회차 수정·전이 API");
    const agencyChange = await api("PATCH", `/api/admin/pilots/${sessionId}`, {
      agencyId: agency.id.toString(),
    });
    check("★기관 변경 409 + IMMUTABLE_FIELD",
      agencyChange.status === 409 && agencyChange.json.reason === "IMMUTABLE_FIELD", agencyChange);

    const nameOk = await api("PATCH", `/api/admin/pilots/${sessionId}`, { managerDisplayName: "박위탁" });
    check("담당자 표시명 수정 200", nameOk.status === 200, nameOk);

    const detail = await api("GET", `/api/admin/pilots/${sessionId}`);
    check("상세 조회 200", detail.status === 200 && detail.json.success === true, detail.status);
    const sess = detail.json.session as Record<string, unknown>;
    check("표시명이 반영됨", sess?.managerDisplayName === "박위탁", sess?.managerDisplayName);
    check("★상세가 회차 사업체를 내려줌(셋업 화면 선택지)", Array.isArray(detail.json.sites) && (detail.json.sites as unknown[]).length === 1);
    check("★상세가 회차 훈련생을 내려줌", Array.isArray(detail.json.trainees) && (detail.json.trainees as unknown[]).length === 1);
    // ★신규 참여자는 계정이 없어 workerName이 null이다 — 초대에 적은 성명이 목록에 보여야 한다.
    const firstPart = (detail.json.participants as Record<string, unknown>[] | undefined)?.[0];
    check("★신규 참여자가 익명으로만 보이지 않음(초대 성명 노출)",
      firstPart?.workerName == null && firstPart?.inviteWorkerName === "스모크지도원", firstPart);

    const badTransition = await api("PATCH", `/api/admin/pilots/${sessionId}`, { status: "ENDED" });
    check("★DRAFT→ENDED 409 + 사유",
      badTransition.status === 409 && badTransition.json.reason === "INVALID_TRANSITION", badTransition);

    const purgeTry = await api("PATCH", `/api/admin/pilots/${sessionId}`, { status: "PURGED" });
    check("★PURGED는 API로 전이 불가 400", purgeTry.status === 400, purgeTry);

    const toReady = await api("PATCH", `/api/admin/pilots/${sessionId}`, { status: "READY" });
    check("DRAFT→READY 200", toReady.status === 200, toReady);

    const noAccepted = await api("PATCH", `/api/admin/pilots/${sessionId}`, { status: "ACTIVE" });
    check("★수락자 없으면 ACTIVE 409 + 사유",
      noAccepted.status === 409 && noAccepted.json.reason === "NO_ACCEPTED", noAccepted);

    // ── 6. DELETE .../participants/[id] ─────────────────────────
    console.log("\n[6] 참여 취소 API");
    const wrongPath = await api("DELETE", `/api/admin/pilots/999999/participants/${participantId}`);
    check("★다른 회차 경로로 취소 시 404", wrongPath.status === 404, wrongPath);

    const cancelRes = await api("DELETE", `/api/admin/pilots/${sessionId}/participants/${participantId}`);
    check("참여 취소 200", cancelRes.status === 200 && cancelRes.json.success === true, cancelRes);
    check("★초대 무효화 보고", cancelRes.json.invalidatedInvite === true, cancelRes);

    // ── 6.5 근무일 API 라우트 계층 (8단계) ──────────────────────
    // ★서비스 로직은 verify-pilot-workday가 24건으로 덮는다. 여기서 보는 것은 라우트뿐이다:
    //  인증·경로 파라미터 검증·입력 검증·존재하지 않는 자원. (커버리지 갭을 숨기지 않는다.)
    console.log("\n[6.5] 근무일 API — 라우트 계층");
    const wdNoAuth = await api("GET", `/api/admin/pilots/${sessionId}/workdays`, undefined, { noAuth: true });
    check("★인증 없이 근무일 조회 401", wdNoAuth.status === 401, wdNoAuth);

    const wdBadSession = await api("GET", "/api/admin/pilots/abc/workdays");
    check("잘못된 회차 ID 400", wdBadSession.status === 400, wdBadSession);

    const wdList = await api("GET", `/api/admin/pilots/${sessionId}/workdays`);
    check("근무일 목록 200 + 배열", wdList.status === 200 && Array.isArray(wdList.json.workdays), wdList);

    const wdNoAsg = await api("POST", `/api/admin/pilots/${sessionId}/workdays`, { workDate: "2026-08-10" });
    check("배정 없이 등록 400", wdNoAsg.status === 400, wdNoAsg);

    const wdGhost = await api("POST", `/api/admin/pilots/${sessionId}/workdays`, {
      assignmentId: "999999999", workDate: "2026-08-10",
    });
    check("★없는 배정으로 등록 404(운영 배정 접근 차단과 같은 관문)",
      wdGhost.status === 404, wdGhost);

    const wdDelGhost = await api("DELETE", `/api/admin/pilots/${sessionId}/workdays/999999999`);
    check("없는 근무일 삭제 404", wdDelGhost.status === 404, wdDelGhost);

    // ── 7. audit 기록 확인 ──────────────────────────────────────
    console.log("\n[7] 감사 기록");
    const audits = await prisma.auditEvent.count({
      where: { entityType: "PilotSession", entityId: sessionId },
    });
    check("★회차 조작이 감사 로그에 남음", audits > 0, { audits });
  } finally {
    // ★정리 실패를 숨기지 않는다. 이전 버전은 모든 삭제를 .catch(()=>{})로 삼키고
    //  "정리 완료"를 출력해, 실제로는 테스트 기관이 dev DB에 쌓이는데도 성공처럼 끝났다.
    //  실패는 사유와 함께 출력하고 스크립트를 실패로 종료시킨다.
    console.log("\n[정리]");
    const cleanupErrors: string[] = [];
    const step = async (label: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { cleanupErrors.push(`${label}: ${(e as Error).message.split("\n")[0]}`); }
    };
    if (sessionId) {
      const sid = BigInt(sessionId);
      // FK 역순 — 순서가 틀리면 여기서 실패가 드러난다(예전엔 조용히 넘어갔다).
      await step("supervision", () => prisma.traineeSupervision.deleteMany({ where: { pilotSessionId: sid } }));
      await step("participantTrainee", () => prisma.pilotParticipantTrainee.deleteMany({ where: { participant: { pilotSessionId: sid } } }));
      await step("participant", () => prisma.pilotParticipant.deleteMany({ where: { pilotSessionId: sid } }));
      await step("workerInvite", () => prisma.workerInvite.deleteMany({ where: { pilotSessionId: sid } }));
      await step("siteAssignment", () => prisma.siteAssignment.deleteMany({ where: { pilotSessionId: sid } }));
      await step("placement", () => prisma.traineePlacement.deleteMany({ where: { pilotSessionId: sid } }));
      await step("trainee", () => prisma.trainee.deleteMany({ where: { createdByPilotSessionId: sid } }));
      await step("site", () => prisma.site.deleteMany({ where: { createdByPilotSessionId: sid } }));
      await step("auditEvent", () => prisma.auditEvent.deleteMany({ where: { entityType: "PilotSession", entityId: sessionId } }));
      await step("pilotSession", () => prisma.pilotSession.delete({ where: { id: sid } }));
    }
    await step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await step("otherAgencySites", () => prisma.site.deleteMany({ where: { agencyId: otherAgency.id } }));
    await step("agency", () => prisma.agency.delete({ where: { id: agency.id } }));
    await step("otherAgency", () => prisma.agency.delete({ where: { id: otherAgency.id } }));

    if (cleanupErrors.length > 0) {
      fail += cleanupErrors.length;
      console.log(`  ❌ 정리 실패 ${cleanupErrors.length}건 — dev DB에 테스트 데이터가 남았습니다:`);
      for (const m of cleanupErrors) console.log(`     · ${m}`);
    } else {
      console.log("  ✅ 테스트 데이터 정리 완료");
    }

    // 이전 실행이 중간에 죽어 남긴 잔여물도 함께 확인한다(누적 방지).
    const stale = await prisma.agency.count({ where: { name: { startsWith: "__sm_" } } });
    if (stale > 0) {
      fail += 1;
      console.log(`  ❌ 이전 실행 잔여 테스트 기관 ${stale}건이 남아 있습니다(__sm_*).`);
    }
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
