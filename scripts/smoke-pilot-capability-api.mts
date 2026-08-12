// scripts/smoke-pilot-capability-api.mts
// 파일럿 문서 차단 **라우트 계층** 스모크 — v1.8 §3.2·§8, §12 6단계.
// 실행: dev 서버(localhost:3000)를 띄운 뒤  npx tsx scripts/smoke-pilot-capability-api.mts
//
// ★verify-pilot-capability.mts는 판정 함수(lib)를 직접 부른다. 이 스크립트는 그게 못 덮는
//  **실제 HTTP 응답**을 본다 — 차단이 라우트에 정말 배선됐는지, 상태코드가 맞는지.
//  "서버에서도 막는다"(§8)는 요구는 이 계층에서만 증명된다.
//
// ★같이 증명하는 것: **파일럿이 기존 라우트를 흔들지 않는다.**
//   · 파일럿 참여자는 문서·서명 라우트를 **한 줄도 안 고친 상태로** 통과한다(planType 경로).
//   · 비파일럿 사용자는 미리보기·생성·제출이 전부 그대로 동작한다.
//
// ⚠️ 외부 발송 안전장치:
//   · 파일럿 이메일 발송은 **발송 코드에 닿기 전에** 403으로 끊기는 것을 확인한다.
//   · 비파일럿 공단 발송은 시험하지 않는다 — signStage=DRAFT run으로 "파일럿 차단에 안 걸리고
//     다음 검사(404)까지 갔다"만 본다. Resend에 닿지 않는다.
//   · 비파일럿 generate는 sendEmail=false로만 호출한다.
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
import * as workerSessionNs from "../app/worker/_lib/session";
import * as managerSessionNs from "../lib/managerSession";

function interop<T>(ns: unknown): T {
  return (ns as { default?: T }).default ?? (ns as T);
}
const { signWorkerToken, WORKER_COOKIE } =
  interop<typeof import("../app/worker/_lib/session")>(workerSessionNs);
const { signManagerSessionToken, MANAGER_SESSION_COOKIE_NAME } =
  interop<typeof import("../lib/managerSession")>(managerSessionNs);

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`, extra === undefined ? "" : JSON.stringify(extra)); }
}

async function req(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") ?? "";
  const json = ct.includes("json") ? await res.json().catch(() => ({})) : {};
  return { status: res.status, json: json as Record<string, unknown>, contentType: ct };
}

async function main() {
  await assertWritableDb();
  const stamp = Date.now();

  try {
    const ping = await fetch(`${BASE}/admin/login`);
    if (!ping.ok) throw new Error(String(ping.status));
  } catch (e) {
    console.error(`dev 서버(${BASE})에 연결할 수 없습니다. \`npm run dev\` 후 다시 실행하세요.`, e);
    process.exit(1);
  }

  const activeOther = await prisma.pilotSession.count({ where: { status: "ACTIVE" } });
  if (activeOther > 0) {
    console.log(`\n⛔ 이미 ACTIVE인 파일럿 회차가 ${activeOther}건 있습니다. 종료 후 다시 실행하세요.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── 고정물 ────────────────────────────────────────────────────
  // ★파일럿 기관은 FREE — 기관 구독 없이 planType만으로 돌아야 한다는 것이 5단계의 요점이다.
  const pilotAgency = await prisma.agency.create({ data: { name: `__smc_pilot_${stamp}`, planType: "FREE" } });
  const realAgency  = await prisma.agency.create({ data: { name: `__smc_real_${stamp}`,  planType: "PRO" } });
  const admin = await prisma.admin.create({
    data: { loginId: `__smc_adm_${stamp}`, passwordHash: "x", displayName: "스모크운영자" },
  });
  const realManager = await prisma.manager.create({
    data: { agencyId: realAgency.id, loginId: `__smc_mgr_${stamp}`, passwordHash: "x", displayName: "담당자" },
  });
  // Manager가 0명이면 planGuard가 셀프등록으로 보고 무료 허용해 FREE 기관 판정이 흐려진다.
  await prisma.manager.create({
    data: { agencyId: pilotAgency.id, loginId: `__smc_pmgr_${stamp}`, passwordHash: "x", displayName: "담당자" },
  });

  const pilotSite = await prisma.site.create({
    data: { companyName: "__smc_site_pilot", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: pilotAgency.id },
  });
  const realSite = await prisma.site.create({
    data: { companyName: "__smc_site_real", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: realAgency.id },
  });

  const mkWorker = (tag: string, planType: "FREE" | "STANDARD") => prisma.worker.create({
    data: {
      loginId: `__smc_${tag}_${stamp}`, password: "x", workerName: `지도원${tag}`,
      phoneNumber: `0113${String(stamp).slice(-6)}${tag.length}`, role: "WORKER", status: "ACTIVE",
      planType,
      // 제출 경로의 "직무지도원 서명 미등록" 400을 피하기 위한 더미 경로(존재 여부만 보는 게이트).
      signatureUrl: `__smc/${tag}/sig.png`,
    },
  });
  // 파일럿 참여자 = 운영자 개인 부여 STANDARD (acceptPilotInvite가 실제로 주는 값).
  const wPilot = await mkWorker("p", "STANDARD");
  const wReal  = await mkWorker("r", "FREE");

  const session = await prisma.pilotSession.create({
    data: {
      agencyId: pilotAgency.id, startDate: D("2026-08-01"), endDate: D("2026-08-31"),
      createdByAdminId: admin.id, status: "ACTIVE", activatedAt: new Date(),
    },
  });

  const mkAssignment = (workerId: bigint, siteId: bigint, agencyId: bigint, pilotSessionId: bigint | null) =>
    prisma.siteAssignment.create({
      data: {
        workerId, siteId, agencyId, pilotSessionId, status: "ACTIVE", workType: "FULL_DAY",
        startDate: D("2026-08-01"), endDate: D("2026-08-31"),
      },
    });
  const aPilot = await mkAssignment(wPilot.id, pilotSite.id, pilotAgency.id, session.id);
  const aReal  = await mkAssignment(wReal.id,  realSite.id,  realAgency.id,  null);

  const pilotCookie = `${WORKER_COOKIE}=${await signWorkerToken({ workerId: wPilot.id.toString(), workerName: wPilot.workerName })}`;
  const realCookie  = `${WORKER_COOKIE}=${await signWorkerToken({ workerId: wReal.id.toString(),  workerName: wReal.workerName })}`;
  const mgrCookie   = `${MANAGER_SESSION_COOKIE_NAME}=${await signManagerSessionToken({
    sub: realManager.id.toString(), agencyId: realAgency.id.toString(), loginId: realManager.loginId,
  })}`;

  const P = { start: "2026-08-05", end: "2026-08-10" };
  const previewQs = (aid: bigint) =>
    `/api/worker/docs/preview?docType=ATTENDANCE_SHEET&periodStart=${P.start}&periodEnd=${P.end}&assignmentId=${aid}`;
  const genBody = (aid: bigint, extra: Record<string, unknown> = {}) => ({
    docType: "ATTENDANCE_SHEET", periodStart: P.start, periodEnd: P.end, assignmentId: aid.toString(), ...extra,
  });

  const createdRunIds: bigint[] = [];

  try {
    // ── ① 파일럿 워커는 기존 라우트를 그대로 통과 ────────────────
    console.log("\n[①] 파일럿 참여자 — 문서 라우트 무수정으로 통과(planType 경로)");
    const pv = await req("GET", previewQs(aPilot.id), pilotCookie);
    check("★FREE 기관인데도 미리보기 200 + PDF 스트림", pv.status === 200 && pv.contentType.includes("pdf"), pv.status);
    const gen = await req("POST", "/api/worker/docs/generate", pilotCookie, genBody(aPilot.id));
    check("★PDF 생성 200(기존 게이트를 안 고치고 통과)", gen.status === 200 && gen.json.success === true, gen);

    // ── ② 파일럿 §3.2 차단 ──────────────────────────────────────
    console.log("\n[②] 파일럿 배정 — 제출·외부전송 차단(서버)");
    const sendMail = await req("POST", "/api/worker/docs/generate", pilotCookie,
      genBody(aPilot.id, { sendEmail: true, toEmail: "nobody@example.com" }));
    check("★이메일 발송 요청 403 PILOT_SEND_BLOCKED",
      sendMail.status === 403 && sendMail.json.reason === "PILOT_SEND_BLOCKED", sendMail);

    const submit = await req("POST", "/api/worker/docs/submit", pilotCookie, {
      periodStart: P.start, periodEnd: P.end, assignmentId: aPilot.id.toString(),
      documents: [{ docType: "ATTENDANCE_SHEET" }],
    });
    check("★위탁기관 제출 403 PILOT_SUBMIT_BLOCKED",
      submit.status === 403 && submit.json.reason === "PILOT_SUBMIT_BLOCKED", submit);
    check("★차단된 제출은 흔적을 남기지 않는다(run 0건)",
      (await prisma.documentRun.count({ where: { assignmentId: aPilot.id } })) === 0);

    // 회차가 끝나도 제출은 여전히 막혀야 한다.
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ENDED" } });
    const submitEnded = await req("POST", "/api/worker/docs/submit", pilotCookie, {
      periodStart: P.start, periodEnd: P.end, assignmentId: aPilot.id.toString(),
      documents: [{ docType: "ATTENDANCE_SHEET" }],
    });
    check("★회차 ENDED 후에도 제출 403(종료가 제출을 열지 않는다)",
      submitEnded.status === 403 && submitEnded.json.reason === "PILOT_SUBMIT_BLOCKED", submitEnded);
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ACTIVE" } });

    // ── ③ 비파일럿 무회귀 ───────────────────────────────────────
    console.log("\n[③] 비파일럿(실운영) 배정 무회귀 — 기존 동선 그대로");
    const rPv = await req("GET", previewQs(aReal.id), realCookie);
    check("미리보기 200", rPv.status === 200 && rPv.contentType.includes("pdf"), rPv.status);
    const rGen = await req("POST", "/api/worker/docs/generate", realCookie, genBody(aReal.id));
    check("PDF 생성 200", rGen.status === 200 && rGen.json.success === true, rGen);

    const rSubmit = await req("POST", "/api/worker/docs/submit", realCookie, {
      periodStart: P.start, periodEnd: P.end, assignmentId: aReal.id.toString(),
      documents: [{ docType: "ATTENDANCE_SHEET" }],
    });
    // ★여기서 400 "직무지도원 서명 미등록"이 나오는 것은 정상이다 — 스모크 워커의 서명 이미지가
    //  스토리지에 실제로 없기 때문이고(buildDocPayload:159가 디코드된 이미지를 요구한다), 이 검사는
    //  파일럿 사전 차단보다 **뒤**에 있다. 즉 여기에 도달했다는 것 자체가 파일럿 차단을 안 탔다는 증거다.
    //  무회귀 주장은 "제출이 성공한다"가 아니라 "파일럿 차단이 비파일럿에 걸리지 않는다"이다.
    check("★비파일럿 제출은 파일럿 차단에 안 걸리고 기존 검사까지 진행",
      rSubmit.status !== 403 && rSubmit.json.reason !== "PILOT_SUBMIT_BLOCKED", rSubmit);
    const realRuns = await prisma.documentRun.findMany({ where: { assignmentId: aReal.id }, select: { id: true } });
    createdRunIds.push(...realRuns.map(r => r.id));

    // 타인(파일럿) 배정 id를 넣어도 남의 문서가 나오지 않는다.
    //  ★거부가 아니라 **폴백**이 정답이다 — resolveDocAssignment는 소유하지 않은 명시 id를 무효로 보고
    //   본인 활성 배정으로 되돌린다(기존 설계·무변경). 파일명의 현장명으로 실제 귀속을 확인한다.
    const cross = await req("POST", "/api/worker/docs/generate", realCookie, genBody(aPilot.id));
    const crossName = String(cross.json.fileName ?? "");
    check("★타인 배정 id는 무시되고 본인 현장 문서가 나온다(크로스테넌트 유출 없음)",
      cross.status === 200 && crossName.includes("real") && !crossName.includes("pilot"),
      { status: cross.status, fileName: crossName });

    // ── ④ 매니저 축 — 공단 발송 차단 ────────────────────────────
    console.log("\n[④] 매니저 축 — 파일럿 문서 공단 발송 차단");
    // 제출 경로가 막혀 파일럿 run은 정상적으로 생기지 않는다. 소비측 방어를 보려면 직접 만든다.
    const pilotRun = await prisma.documentRun.create({
      data: {
        agencyId: realAgency.id, assignmentId: aPilot.id, siteId: pilotSite.id, workerId: wPilot.id,
        docType: "ATTENDANCE_SHEET", periodStart: D("2026-08-01"), periodEnd: D("2026-08-31"),
        openAt: new Date(), dueAt: D("2026-08-31"), signStage: "SUBMITTED",
      },
    });
    createdRunIds.push(pilotRun.id);

    const send = await req("POST", "/api/admin/document-runs/send", mgrCookie, {
      to: "nobody@example.com", ids: [pilotRun.id.toString()], groupBy: "none",
    });
    check("★파일럿 run 공단 발송 403 PILOT_SEND_BLOCKED",
      send.status === 403 && send.json.reason === "PILOT_SEND_BLOCKED", send);

    // 비파일럿 대조 — 파일럿 차단에 안 걸리고 다음 검사(발송대상 없음 404)까지 간다.
    //  ★DRAFT run을 쓰는 이유: 실제 이메일 발송에 닿지 않게 하려는 것이다.
    const draftRun = await prisma.documentRun.create({
      data: {
        agencyId: realAgency.id, assignmentId: aReal.id, siteId: realSite.id, workerId: wReal.id,
        docType: "TRAINING_DAILY_LOG", periodStart: D("2026-08-01"), periodEnd: D("2026-08-31"),
        openAt: new Date(), dueAt: D("2026-08-31"), signStage: "DRAFT",
      },
    });
    createdRunIds.push(draftRun.id);
    const sendReal = await req("POST", "/api/admin/document-runs/send", mgrCookie, {
      to: "nobody@example.com", ids: [draftRun.id.toString()], groupBy: "none",
    });
    check("★비파일럿은 파일럿 차단에 안 걸리고 다음 검사로 진행(404)",
      sendReal.status === 404 && sendReal.json.reason !== "PILOT_SEND_BLOCKED", sendReal);

    const mixed = await req("POST", "/api/admin/document-runs/send", mgrCookie, {
      to: "nobody@example.com", ids: [draftRun.id.toString(), pilotRun.id.toString()], groupBy: "none",
    });
    check("★파일럿이 섞이면 묶음 전체 403", mixed.status === 403 && mixed.json.reason === "PILOT_SEND_BLOCKED", mixed);

  } finally {
    console.log("\n[정리]");
    const c = new CleanupGuard();
    await c.step("documentVersion", () => prisma.documentVersion.deleteMany({ where: { runId: { in: createdRunIds } } }));
    await c.step("submissionLog", () => prisma.documentSubmissionLog.deleteMany({ where: { runId: { in: createdRunIds } } }));
    await c.step("documentRun", () => prisma.documentRun.deleteMany({
      where: { agencyId: { in: [pilotAgency.id, realAgency.id] } },
    }));
    await c.step("managerNotice", () => prisma.managerNotice.deleteMany({ where: { managerId: realManager.id } }));
    await c.step("siteSignToken", () => prisma.siteSignToken.deleteMany({ where: { assignmentId: { in: [aPilot.id, aReal.id] } } }));
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({
      where: { agencyId: { in: [pilotAgency.id, realAgency.id] } },
    }));
    await c.step("pilotSession", () => prisma.pilotSession.delete({ where: { id: session.id } }));
    await c.step("workers", () => prisma.worker.deleteMany({ where: { id: { in: [wPilot.id, wReal.id] } } }));
    await c.step("sites", () => prisma.site.deleteMany({ where: { id: { in: [pilotSite.id, realSite.id] } } }));
    await c.step("managers", () => prisma.manager.deleteMany({ where: { agencyId: { in: [pilotAgency.id, realAgency.id] } } }));
    await c.step("admin", () => prisma.admin.delete({ where: { id: admin.id } }));
    await c.step("agencies", () => prisma.agency.deleteMany({ where: { id: { in: [pilotAgency.id, realAgency.id] } } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__smc_"]);
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
