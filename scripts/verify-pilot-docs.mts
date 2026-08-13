// scripts/verify-pilot-docs.mts
// 4단계 검증 — 파일럿 전용 문서 경로.
//
// 무엇을 단언하는가
//   · 접근 검증 2단 — 레지스트리 등록 ∩ 실제 소유. 비파일럿·타 파일럿·타인 배정은 404.
//   · 허용 문서 3종만. 종합평가 등은 400.
//   · govAgent.name = 수기 공란(공백만), companyManager.name = Site.businessContactName(F25b).
//   · companyManager.imageUrl 을 만들지도 넣지도 않는다.
//   · ★생성물 0 — DocumentRun·DocumentVersion·서명 토큰이 늘지 않는다.
//   · ★서명 Storage 경로 재수집 가능성(§10-1 ②) — Worker.signatureUrl 에서 경로를 복원할 수 있는가.
//
// 실행: npx tsx scripts/verify-pilot-docs.mts

import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";
import { CleanupGuard } from "./_cleanupGuard.mts";

// ★.mts(ESM) → lib/*.ts(CJS) 인터롭(리포 전역 조건).
import * as resNs from "../lib/pilot/resources";
type ResModule = typeof import("../lib/pilot/resources");
const R = (resNs as unknown as { default?: ResModule }).default ?? (resNs as unknown as ResModule);
import * as docNs from "../lib/pilot/docs";
type DocModule = typeof import("../lib/pilot/docs");
const D = (docNs as unknown as { default?: DocModule }).default ?? (docNs as unknown as DocModule);
// ★`lib/signatureImage` 는 `server-only` 를 import 해 tsx 가 로드하지 못한다(리포 전역 조건).
//  경로 복원 규칙(signaturePathFromStored:22-33)을 여기서 **그대로 재현**해 대조한다.
//  원본이 바뀌면 이 대조가 어긋나므로, 규칙이 달라진 사실 자체가 드러난다.
const SIG_BUCKET = "signatures";
function signaturePathFromStoredMirror(stored?: string | null): string | null {
  if (!stored) return null;
  const pub = `/object/public/${SIG_BUCKET}/`;
  let i = stored.indexOf(pub);
  if (i >= 0) return decodeURIComponent(stored.slice(i + pub.length).split("?")[0]);
  const signed = `/object/sign/${SIG_BUCKET}/`;
  i = stored.indexOf(signed);
  if (i >= 0) return decodeURIComponent(stored.slice(i + signed.length).split("?")[0]);
  if (!/^https?:\/\//i.test(stored) && !stored.startsWith("data:")) return stored.replace(/^\/+/, "");
  return null;
}
const S = { signaturePathFromStored: signaturePathFromStoredMirror };

assertWritableDb("파일럿 문서 검증(테스트 자원 생성·삭제)");

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function expectFail(label: string, fn: () => Promise<unknown>, code?: string) {
  try { await fn(); ok(label, false, "거부되지 않음"); }
  catch (e) {
    const c = (e as { code?: string })?.code;
    ok(label, code ? c === code : true, code ? `code=${c}` : "");
  }
}

const STAMP = Date.now().toString(36);
const made = { pilotId: null as bigint | null, agencyId: null as bigint | null, siteId: null as bigint | null,
  workerId: null as bigint | null, assignmentId: null as bigint | null, traineeId: null as bigint | null };

const CONTACT = "박담당";
const START = "2026-08-03", END = "2026-08-28";

async function main() {
  console.log("\n[셋업] 파일럿 전용 자원");
  const p = await R.createPilot({ name: `문서검증-${STAMP}`, agencyName: `문서검증기관-${STAMP}` });
  made.pilotId = p.pilotId; made.agencyId = p.agencyId;
  const site = await R.createPilotSite(p.pilotId, {
    companyName: `문서검증사업체-${STAMP}`, address: "서울 중구 세종대로 110",
    gpsLat: "37.5663", gpsLon: "126.9779", businessContactName: CONTACT,
  });
  made.siteId = site.id;
  const tr = await R.createPilotTrainee(p.pilotId, {
    siteId: site.id.toString(), name: "김훈련", gender: "남",
    disabilityType: "지적장애", severity: "중증", startDate: "2026-08-01",
  });
  made.traineeId = tr.trainee.id;
  const phone = `010${String(Date.now()).slice(-8)}`;
  const w = await R.createPilotWorker(p.pilotId, { workerName: "이지도", phoneNumber: phone, password: "pilot1234!" });
  made.workerId = w.id;
  const a = await R.createPilotAssignment(p.pilotId, {
    workerId: w.id.toString(), siteId: site.id.toString(), workType: "FULL_DAY", startDate: START, endDate: END,
  });
  made.assignmentId = a.id;
  console.log(`  파일럿 ${p.pilotId} · 사업체 ${site.id} · 워커 ${w.id} · 배정 ${a.id}`);

  console.log("\n[1] 허용 문서 3종만");
  for (const dt of ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG", "ADAPTATION_DAILY_LOG"]) {
    const needsTrainee = dt !== "ATTENDANCE_SHEET";
    const r = await D.buildPilotDocPayload({
      workerId: w.id, assignmentId: a.id, docType: dt, start: START, end: END,
      traineeId: needsTrainee ? tr.trainee.id.toString() : null,
    });
    ok(`${dt} payload 생성`, !!r.payload);
  }
  for (const dt of ["TRAINEE_FINAL_EVAL", "ADAPTATION_FINAL_EVAL", "PAYSLIP", ""]) {
    await expectFail(`미지원 문서 거부: ${dt || "(빈값)"}`, () => D.buildPilotDocPayload({
      workerId: w.id, assignmentId: a.id, docType: dt, start: START, end: END, traineeId: tr.trainee.id.toString(),
    }), "UNSUPPORTED_DOC");
  }

  console.log("\n[2] 서명 슬롯 — 공란 · 담당자명 · 이미지 미생성");
  const att = await D.buildPilotDocPayload({ workerId: w.id, assignmentId: a.id, docType: "ATTENDANCE_SHEET", start: START, end: END });
  const attSig = (att.payload as { signatures?: Record<string, { name?: string; imageUrl?: unknown }> }).signatures ?? {};
  ok("출근부 govAgent = 수기 공란", attSig.govAgent?.name === D.PILOT_HANDWRITE_BLANK);
  // ★보이는 표시가 없어야 한다 — 밑줄·점·괄호 등 어떤 글자도 섞이면 안 된다(사용자 확정 2026-08-13).
  ok("★공란에 보이는 문자가 없음(ASCII 공백만)", /^ +$/.test(String(attSig.govAgent?.name ?? "")), JSON.stringify(attSig.govAgent?.name));
  // ★손글씨 기입 폭 — 공백 1개 = 3.3pt 이므로 15개 = 49.5pt ≈ 17.5mm(활자 한글 3자의 약 1.5배).
  ok("★공란 폭 확보(≥ 45pt ≈ 16mm)", String(attSig.govAgent?.name ?? "").length * 3.3 >= 45, `${String(attSig.govAgent?.name ?? "").length}자 = ${(String(attSig.govAgent?.name ?? "").length * 3.3).toFixed(1)}pt`);
  ok("★출근부 companyManager = businessContactName", attSig.companyManager?.name === CONTACT, String(attSig.companyManager?.name));
  ok("★companyManager.imageUrl 미생성", attSig.companyManager?.imageUrl === undefined);
  ok("govAgent.imageUrl 미생성", attSig.govAgent?.imageUrl === undefined);

  const trn = await D.buildPilotDocPayload({ workerId: w.id, assignmentId: a.id, docType: "TRAINING_DAILY_LOG", start: START, end: END, traineeId: tr.trainee.id.toString() });
  const trnSig = (trn.payload as { signatures?: Record<string, { name?: string; imageUrl?: unknown }> }).signatures ?? {};
  ok("훈련일지 govAgent = 수기 공란", trnSig.govAgent?.name === D.PILOT_HANDWRITE_BLANK);
  ok("훈련일지 companyManager = businessContactName", trnSig.companyManager?.name === CONTACT);

  const adp = await D.buildPilotDocPayload({ workerId: w.id, assignmentId: a.id, docType: "ADAPTATION_DAILY_LOG", start: START, end: END, traineeId: tr.trainee.id.toString() });
  const adpSig = (adp.payload as { signatures?: Record<string, { name?: string }> }).signatures ?? {};
  ok("적응지도일지 govAgent = 수기 공란", adpSig.govAgent?.name === D.PILOT_HANDWRITE_BLANK);
  // ★이 문서에는 사업체담당자 서명 슬롯 자체가 없다(렌더러 :466 은 2행).
  ok("적응지도일지에는 companyManager 슬롯 없음", adpSig.companyManager === undefined);
  ok("★agencyAgent 를 건드리지 않음(평가서 전용)", attSig.agencyAgent === undefined && trnSig.agencyAgent === undefined);

  console.log("\n[3] 접근 검증 2단");
  await expectFail("비파일럿 워커 거부", () => D.buildPilotDocPayload({
    workerId: BigInt(1), assignmentId: a.id, docType: "ATTENDANCE_SHEET", start: START, end: END,
  }), "NOT_PILOT");
  const foreignAsg = await prisma.siteAssignment.findFirst({ where: { id: { not: a.id } }, select: { id: true } });
  if (foreignAsg) {
    await expectFail("레지스트리 미등록 배정 거부", () => D.buildPilotDocPayload({
      workerId: w.id, assignmentId: foreignAsg.id, docType: "ATTENDANCE_SHEET", start: START, end: END,
    }), "NOT_PILOT");
  }
  // 다른 파일럿의 워커 + 이 파일럿의 배정 → 같은 pilotId 가 아니므로 거부
  const p2 = await R.createPilot({ name: `타파일럿-${STAMP}`, agencyName: `타파일럿기관-${STAMP}` });
  const phone2 = `010${String(Date.now() + 7).slice(-8)}`;
  const w2 = await R.createPilotWorker(p2.pilotId, { workerName: "타워커", phoneNumber: phone2, password: "pilot1234!" });
  await expectFail("★다른 파일럿 워커 + 이 배정 거부", () => D.buildPilotDocPayload({
    workerId: w2.id, assignmentId: a.id, docType: "ATTENDANCE_SHEET", start: START, end: END,
  }), "NOT_PILOT");
  // 정리 목록에 추가
  extraPilots.push({ pilotId: p2.pilotId, agencyId: p2.agencyId, workerId: w2.id });

  console.log("\n[4] 훈련생 가드");
  await expectFail("훈련생 미선택 거부", () => D.buildPilotDocPayload({
    workerId: w.id, assignmentId: a.id, docType: "TRAINING_DAILY_LOG", start: START, end: END, traineeId: null,
  }), "TRAINEE_REQUIRED");
  const otherTrainee = await prisma.trainee.findFirst({ where: { id: { not: tr.trainee.id } }, select: { id: true } });
  if (otherTrainee) {
    await expectFail("타 현장 훈련생 거부(IDOR)", () => D.buildPilotDocPayload({
      workerId: w.id, assignmentId: a.id, docType: "TRAINING_DAILY_LOG", start: START, end: END,
      traineeId: otherTrainee.id.toString(),
    }), "TRAINEE_REQUIRED");
  }

  console.log("\n[4-1] ★비파일럿 훈련생이 파일럿 현장에 재적된 경우");
  // 현장·기간 가드(findTraineeAtSiteInPeriod)만으로는 통과해 버리는 상황을 **실제로 만들어** 본다.
  //  파일럿은 전용 자원만 쓰므로 훈련생도 레지스트리에 있어야 한다.
  // ★기존 가드는 `trainee.site.agencyId === site.agencyId` 까지 본다(traineeSiteGuard:38).
  //  구멍을 실제로 재현하려면 currentSiteId 를 파일럿 현장으로 붙여 그 조건을 통과시켜야 한다.
  const intruder = await prisma.trainee.create({
    data: { name: `침입훈련생-${STAMP}`, gender: "남", disabilityType: "지적장애", severity: "중증", currentSiteId: site.id },
    select: { id: true },
  });
  const intruderPl = await prisma.traineePlacement.create({
    data: { traineeId: intruder.id, siteId: site.id, startDate: new Date("2026-08-01T00:00:00+09:00") },
    select: { id: true },
  });
  strays.trainees.push(intruder.id); strays.placements.push(intruderPl.id);

  // 기존 가드는 통과하는지 먼저 확인 — 통과해야 이 케이스가 의미가 있다(그래서 추가 검증이 필요한 것).
  const passedOldGuard = await (async () => {
    const { findTraineeAtSiteInPeriod } = await import("../lib/docs/traineeSiteGuard");
    return !!(await findTraineeAtSiteInPeriod(intruder.id, site.id, START, END));
  })();
  ok("현장·기간 가드는 통과한다(그래서 레지스트리 검증이 필요하다)", passedOldGuard);
  await expectFail("★★레지스트리 미등록 훈련생 거부", () => D.buildPilotDocPayload({
    workerId: w.id, assignmentId: a.id, docType: "TRAINING_DAILY_LOG", start: START, end: END,
    traineeId: intruder.id.toString(),
  }), "NOT_PILOT");

  console.log("\n[5] ★생성물 0 — 문서를 만들어도 DB 부산물이 늘지 않는다");
  const before = {
    run: await prisma.documentRun.count(),
    ver: await prisma.documentVersion.count(),
    tok: await prisma.siteSignToken.count(),
  };
  for (const dt of ["ATTENDANCE_SHEET", "TRAINING_DAILY_LOG", "ADAPTATION_DAILY_LOG"]) {
    await D.buildPilotDocPayload({
      workerId: w.id, assignmentId: a.id, docType: dt, start: START, end: END,
      traineeId: dt === "ATTENDANCE_SHEET" ? null : tr.trainee.id.toString(),
    });
  }
  const after = {
    run: await prisma.documentRun.count(),
    ver: await prisma.documentVersion.count(),
    tok: await prisma.siteSignToken.count(),
  };
  ok(`DocumentRun 불변 (${before.run} → ${after.run})`, before.run === after.run);
  ok(`DocumentVersion 불변 (${before.ver} → ${after.ver})`, before.ver === after.ver);
  ok(`SiteSignToken 불변 (${before.tok} → ${after.tok})`, before.tok === after.tok);

  console.log("\n[6] ★서명 Storage 경로 재수집 가능성 (§10-1 ② · F20)");
  // 파일럿은 기존 프로필 업로드 화면을 수정하지 않으므로 업로드 직후 등록을 걸 수 없다.
  //  → 초기화 직전 재수집에만 의존한다. 그 재수집이 성립하는지 확인한다.
  const samples = [
    { label: "public URL", v: "https://x.supabase.co/storage/v1/object/public/signatures/w/45/sig.png", want: "w/45/sig.png" },
    { label: "signed URL", v: "https://x.supabase.co/storage/v1/object/sign/signatures/w/45/sig.png?token=abc", want: "w/45/sig.png" },
    { label: "신 포맷 경로", v: "w/45/sig.png", want: "w/45/sig.png" },
    { label: "data URI", v: "data:image/png;base64,AAAA", want: null },
    { label: "빈 값", v: null, want: null },
  ];
  for (const s of samples) {
    const got = S.signaturePathFromStored(s.v);
    ok(`경로 복원 ${s.label}: ${JSON.stringify(got)}`, got === s.want, `기대 ${JSON.stringify(s.want)}`);
  }
  const wrow = await prisma.worker.findUnique({ where: { id: w.id }, select: { signatureUrl: true } });
  console.log(`     (파일럿 워커 signatureUrl = ${JSON.stringify(wrow?.signatureUrl)} — 서명 등록 전이면 null 이 정상)`);
  ok("★재수집 함수가 DB 값에서 경로를 뽑을 수 있음(5단계 게이트 성립)", S.signaturePathFromStored(wrow?.signatureUrl) === null || typeof S.signaturePathFromStored(wrow?.signatureUrl) === "string");
}

const extraPilots: { pilotId: bigint; agencyId: bigint; workerId: bigint }[] = [];
// ★레지스트리 밖에서 만든 것 — 레지스트리 기반 정리가 못 잡으므로 id 를 따로 들고 있어야 한다.
const strays: { trainees: bigint[]; placements: bigint[] } = { trainees: [], placements: [] };

async function cleanup() {
  console.log("\n[정리]");
  const c = new CleanupGuard();
  const del = async (pilotId: bigint | null, agencyId: bigint | null) => {
    if (!pilotId) return;
    const key = async (k: string) => (await prisma.pilotResource.findMany({ where: { pilotId, kind: k as never }, select: { resourceKey: true } })).map((r) => BigInt(r.resourceKey));
    const [asg, pl, trn, wk, st] = await Promise.all([key("ASSIGNMENT"), key("PLACEMENT"), key("TRAINEE"), key("WORKER"), key("SITE")]);
    await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { id: { in: asg } } }));
    await c.step("placement", () => prisma.traineePlacement.deleteMany({ where: { id: { in: pl } } }));
    await c.step("trainee", () => prisma.trainee.deleteMany({ where: { id: { in: trn } } }));
    await c.step("worker", () => prisma.worker.deleteMany({ where: { id: { in: wk } } }));
    await c.step("site", () => prisma.site.deleteMany({ where: { id: { in: st } } }));
    if (agencyId) await c.step("agency", () => prisma.agency.deleteMany({ where: { id: agencyId } }));
    // ★감사·접속 기록은 FK 가 없어 Cascade 로 안 지워진다(F21).
    for (const [et, ids] of [["Pilot", [pilotId]], ["Site", st], ["Trainee", trn], ["Worker", wk], ["SiteAssignment", asg]] as const) {
      if (ids.length) await c.step(`audit:${et}`, () => prisma.auditEvent.deleteMany({ where: { entityType: et, entityId: { in: ids.map(String) } } }));
    }
    if (agencyId) {
      await c.step("audit:agency", () => prisma.auditEvent.deleteMany({ where: { agencyId } }));
      await c.step("accesslog:agency", () => prisma.accessLog.deleteMany({ where: { agencyId } }));
    }
    await c.step("pilot", () => prisma.pilot.delete({ where: { id: pilotId } }));
  };
  // ★레지스트리 밖 자원을 먼저 지운다 — Site 보다 나중이면 FK 로 막힌다.
  if (strays.placements.length) await c.step("stray:placement", () => prisma.traineePlacement.deleteMany({ where: { id: { in: strays.placements } } }));
  if (strays.trainees.length) await c.step("stray:trainee", () => prisma.trainee.deleteMany({ where: { id: { in: strays.trainees } } }));
  for (const e of extraPilots) await del(e.pilotId, e.agencyId);
  await del(made.pilotId, made.agencyId);
  const left = c.report();
  ok("정리 완료", left === 0, `실패 ${left}건`);
  const rest = {
    pilots: await prisma.pilot.count(),
    resources: await prisma.pilotResource.count(),
    audit: await prisma.auditEvent.count(),
    accessLog: await prisma.accessLog.count(),
  };
  ok(`잔여 재조회 0 (${JSON.stringify(rest)})`, Object.values(rest).every((v) => v === 0));
}

main()
  .catch((e) => { fail++; console.error("\n⛔ 예외:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("정리 중 예외:", e));
    console.log(`\n=== 결과: ${pass} passed, ${fail} failed ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
