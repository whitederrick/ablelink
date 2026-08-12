// scripts/verify-pilot-workday.mts
// 파일럿 근무일 확인·정정 검증 — v1.8 §10, §12 8단계.
// 실행: npx tsx scripts/verify-pilot-workday.mts
//
// ★가장 중요한 주장: **운영 근태는 이 경로로 못 건드린다.**
//   파일럿 화면이 실수로든 고의로든 일반 배정의 출근부를 고칠 수 있으면 안 된다.
//   그래서 비파일럿 배정 id를 넣었을 때 거부되는지를 양성/음성 양쪽으로 확인한다.
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
const wdNs = await import("../lib/pilot/workday");
const { listPilotWorkdays, createPilotWorkday, updatePilotWorkday, deletePilotWorkday } =
  interop<typeof import("../lib/pilot/workday")>(wdNs);

const prisma = new PrismaClient();
const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
let pass = 0, fail = 0;
function check(label: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}`, detail !== undefined ? JSON.stringify(detail, bi) : ""); }
}
function bi(_k: string, v: unknown) { return typeof v === "bigint" ? v.toString() : v; }

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function shift(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function main() {
  await assertWritableDb();
  const stamp = Date.now();
  const c = new CleanupGuard();
  const today = kstToday();
  // 회차·배정 기간은 오늘을 가운데 두고 넉넉히 잡는다(경계 케이스를 따로 만든다).
  const periodStart = shift(today, -30), periodEnd = shift(today, 30);

  // ★픽스처 생성도 try 안에서 한다.
  //  처음엔 try 밖에서 만들었는데, 중간에 스키마 필수 필드 누락으로 죽자 앞서 만든 기관·운영자·
  //  현장·워커가 dev DB에 그대로 남았다(다음 실행의 assertNoStale이 잡아냈다).
  //  "성공 경로에서만 정리되는 정리 코드"는 정리 코드가 아니다.
  let agency: { id: bigint } | null = null;
  let admin: { id: bigint } | null = null;
  let site: { id: bigint } | null = null;
  let worker: { id: bigint } | null = null;
  let trainee: { id: bigint } | null = null;
  const sessionIds: bigint[] = [];

  try {
    agency = await prisma.agency.create({ data: { name: `__wd_ag_${stamp}`, planType: "FREE" } });
    admin = await prisma.admin.create({
      data: { loginId: `__wd_adm_${stamp}`, passwordHash: "x", displayName: "운영자" },
    });
    site = await prisma.site.create({
      data: { companyName: "__wd_site", address: "서울", gpsLat: 37.5, gpsLon: 127.0, agencyId: agency.id },
    });
    worker = await prisma.worker.create({
      data: {
        loginId: `__wd_w_${stamp}`, password: "x", workerName: "지도원",
        phoneNumber: `0114${String(stamp).slice(-7)}`, role: "WORKER", status: "ACTIVE", planType: "STANDARD",
      },
    });
    trainee = await prisma.trainee.create({
      data: { name: "__wd_tr", gender: "M", disabilityType: "지적", severity: "심하지 않은", currentSiteId: site.id },
    });

    // 생성이 끝난 시점의 비-null 별칭 — 아래 본문은 이 값들만 쓴다(정리용 변수는 null 가능).
    const AG = agency, ST = site, WK = worker, TR = trainee;
    const session = await prisma.pilotSession.create({
      data: {
        agencyId: AG.id, startDate: D(periodStart), endDate: D(periodEnd),
        createdByAdminId: admin.id, status: "ACTIVE", activatedAt: new Date(),
      },
    });
    sessionIds.push(session.id);

    const mkAssignment = (pilotSessionId: bigint | null) =>
      prisma.siteAssignment.create({
        data: {
          workerId: WK.id, siteId: ST.id, agencyId: AG.id, pilotSessionId,
          status: "ACTIVE", workType: "FULL_DAY",
          startDate: D(periodStart), endDate: D(periodEnd),
        },
      });
    const aPilot = await mkAssignment(session.id);
    const aNormal = await mkAssignment(null);

    // ── ① 생성 ───────────────────────────────────────────────
    console.log("\n[①] 근무일 생성");
    const d1 = shift(today, -3);
    const r1 = await createPilotWorkday({ pilotSessionId: session.id, assignmentId: aPilot.id, workDate: d1 });
    check("과거 날짜 생성 성공", r1.ok, r1);

    const dup = await createPilotWorkday({ pilotSessionId: session.id, assignmentId: aPilot.id, workDate: d1 });
    check("★중복 등록 → 409(500 아님 — DB unique를 사용자 오류로 번역)",
      !dup.ok && dup.code === "DUPLICATE" && dup.status === 409, dup);

    const future = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aPilot.id, workDate: shift(today, 1),
    });
    check("★미래 날짜 거부(§10 사전 생성 금지)", !future.ok && future.code === "FUTURE_DATE", future);

    const todayOk = await createPilotWorkday({ pilotSessionId: session.id, assignmentId: aPilot.id, workDate: today });
    check("★오늘은 허용(경계 — 미래 판정이 하루 밀리지 않는지)", todayOk.ok, todayOk);

    const outRange = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aPilot.id, workDate: shift(periodStart, -1),
    });
    check("회차·배정 기간 밖 거부", !outRange.ok && outRange.code === "OUT_OF_RANGE", outRange);

    const badDate = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aPilot.id, workDate: "2026-02-31",
    });
    check("★달력에 없는 날짜(2026-02-31) 거부 — 롤오버 방지",
      !badDate.ok && badDate.code === "INVALID_DATE", badDate);

    const badTime = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aPilot.id, workDate: shift(today, -4), start: "18:00", end: "09:00",
    });
    check("퇴근이 출근보다 빠르면 거부", !badTime.ok && badTime.code === "INVALID_DATE", badTime);

    // ── ② 운영 근태 보호 ─────────────────────────────────────
    console.log("\n[②] ★운영 근태는 이 경로로 못 건드린다");
    const onNormal = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aNormal.id, workDate: shift(today, -5),
    });
    check("★비파일럿 배정에 생성 시도 → NOT_PILOT 거부",
      !onNormal.ok && onNormal.code === "NOT_PILOT", onNormal);

    // 운영 배정의 실제 근태를 만들어 두고, 파일럿 경로로 수정·삭제가 되는지 본다.
    const normalAtt = await prisma.dailyAttendance.create({
      data: {
        workerId: WK.id, siteId: ST.id, assignmentId: aNormal.id, workDate: shift(today, -6),
        startTime: new Date(), endTime: new Date(), status: "DONE",
      },
    });
    const upNormal = await updatePilotWorkday({
      pilotSessionId: session.id, attendanceId: normalAtt.id, start: "10:00", end: "17:00",
    });
    check("★운영 근태 수정 시도 → NOT_PILOT 거부", !upNormal.ok && upNormal.code === "NOT_PILOT", upNormal);
    const delNormal = await deletePilotWorkday({
      pilotSessionId: session.id, attendanceId: normalAtt.id, force: true,
    });
    check("★운영 근태 삭제 시도 → force여도 NOT_PILOT 거부",
      !delNormal.ok && delNormal.code === "NOT_PILOT", delNormal);
    const stillThere = await prisma.dailyAttendance.findUnique({ where: { id: normalAtt.id } });
    check("★운영 근태가 실제로 살아 있다(거부가 말뿐이 아님)", stillThere !== null);

    // 다른 회차 id로 접근해도 막히는가(회차 간 교차 접근).
    const other = await prisma.pilotSession.create({
      data: {
        agencyId: AG.id, startDate: D(periodStart), endDate: D(periodEnd),
        createdByAdminId: admin.id, status: "DRAFT",
      },
    });
    sessionIds.push(other.id);
    const cross = await createPilotWorkday({
      pilotSessionId: other.id, assignmentId: aPilot.id, workDate: shift(today, -7),
    });
    check("★다른 회차 id로 남의 배정 접근 → 거부", !cross.ok && cross.code === "NOT_PILOT", cross);

    // ── ③ 수정 ───────────────────────────────────────────────
    console.log("\n[③] 시각 정정");
    const list1 = await listPilotWorkdays(session.id);
    const target = list1.find(r => r.workDate === d1)!;
    check("목록에 생성한 근무일이 보인다", target !== undefined && target.linkedLogs === 0, list1.length);
    const up = await updatePilotWorkday({
      pilotSessionId: session.id, attendanceId: BigInt(target.id), start: "10:30", end: "16:30",
    });
    check("시각 정정 성공", up.ok, up);
    const after = (await listPilotWorkdays(session.id)).find(r => r.id === target.id)!;
    check("★정정 결과가 KST 시각으로 되읽힌다(왕복 검증)",
      after.start === "10:30" && after.end === "16:30", after);

    // ── ④ 삭제와 일지 보호 ───────────────────────────────────
    console.log("\n[④] 삭제 — 일지가 붙으면 조용히 지우지 않는다");
    const withLog = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aPilot.id, workDate: shift(today, -8),
    });
    if (!withLog.ok) throw new Error("사전 조건 실패");
    await prisma.traineeLog.create({
      data: {
        traineeId: TR.id, writerId: WK.id, trainingType: "FIELD",
        attendanceId: BigInt(withLog.value.id), content: "검증용 일지",
      },
    });
    const blocked = await deletePilotWorkday({ pilotSessionId: session.id, attendanceId: BigInt(withLog.value.id) });
    check("★일지가 붙은 근무일 삭제 → 409 차단", !blocked.ok && blocked.code === "HAS_LINKED_LOGS", blocked);
    check("차단 메시지에 함께 지워질 일지 건수가 있다",
      !blocked.ok && /1건/.test(blocked.message), blocked);
    const survived = await prisma.dailyAttendance.findUnique({ where: { id: BigInt(withLog.value.id) } });
    check("★차단됐으면 근무일이 살아 있어야 한다", survived !== null);

    const listWithLog = await listPilotWorkdays(session.id);
    check("목록이 일지 연결 건수를 노출한다(화면이 경고할 근거)",
      listWithLog.find(r => r.id === withLog.value.id)?.linkedLogs === 1, listWithLog);

    const forced = await deletePilotWorkday({
      pilotSessionId: session.id, attendanceId: BigInt(withLog.value.id), force: true,
    });
    check("force면 삭제되고 동반 삭제 건수를 돌려준다",
      forced.ok && forced.value.deletedLogs === 1, forced);
    const logsLeft = await prisma.traineeLog.count({ where: { traineeId: TR.id } });
    check("★Cascade로 일지도 실제로 사라졌다(경고가 사실이었다)", logsLeft === 0);

    const gone = await deletePilotWorkday({ pilotSessionId: session.id, attendanceId: BigInt(withLog.value.id) });
    check("이미 지운 근무일 재삭제 → 404", !gone.ok && gone.code === "NOT_FOUND", gone);

    // ── ⑤ 회차 상태 게이트 ───────────────────────────────────
    console.log("\n[⑤] ACTIVE 회차에서만 정정");
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ENDED" } });
    const ended = await createPilotWorkday({
      pilotSessionId: session.id, assignmentId: aPilot.id, workDate: shift(today, -9),
    });
    check("★ENDED 회차 → 정정 거부", !ended.ok && ended.code === "SESSION_NOT_ACTIVE", ended);
    const listEnded = await listPilotWorkdays(session.id);
    check("★조회는 ENDED에서도 된다(확인은 막지 않는다)", listEnded.length > 0);
    await prisma.pilotSession.update({ where: { id: session.id }, data: { status: "ACTIVE" } });

  } finally {
    console.log("\n[정리]");
    // 만들어진 것만 지운다 — 생성 도중 죽어도 여기까지 온다(위 주석 참고).
    const wId = worker?.id, aId = agency?.id;
    if (wId) {
      await c.step("traineeLog", () => prisma.traineeLog.deleteMany({ where: { writerId: wId } }));
      await c.step("dailyAttendance", () => prisma.dailyAttendance.deleteMany({ where: { workerId: wId } }));
    }
    if (aId) await c.step("assignment", () => prisma.siteAssignment.deleteMany({ where: { agencyId: aId } }));
    for (const sid of sessionIds) {
      await c.step(`pilotSession#${sid}`, () => prisma.pilotSession.delete({ where: { id: sid } }));
    }
    if (trainee) await c.step("trainee", () => prisma.trainee.delete({ where: { id: trainee!.id } }));
    if (wId) await c.step("worker", () => prisma.worker.delete({ where: { id: wId } }));
    if (site) await c.step("site", () => prisma.site.delete({ where: { id: site!.id } }));
    if (admin) await c.step("admin", () => prisma.admin.delete({ where: { id: admin!.id } }));
    if (aId) await c.step("agency", () => prisma.agency.delete({ where: { id: aId } }));
    fail += c.report();
    fail += await c.assertNoStale(prisma, ["__wd_"]);
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
