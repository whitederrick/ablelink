// scripts/verify-attendance-holiday.mts
// 출근부(ATTENDANCE_SHEET) 휴무일 반영 검증 — 2026-08-22.
//
// 무엇을 단언하는가
//   · 휴무일(SiteHoliday, countAsWorkday=false)로 등록된 날짜는 출근부 entries·총계에서 빠진다.
//   · countAsWorkday=true(근무 인정일)는 빠지지 않는다 — cron/daily·bulk-generate와 동일 기준.
//   · 휴무일은 배정(assignmentId) 단위 — 같은 워커의 다른 배정 휴무일이 이 출근부를 지우지 않는다.
//   · ★양성 대조: 휴무일 등록 전에는 그 날짜가 실제로 들어 있었다(감지기가 살아 있는가).
//   · DailyAttendance 행 자체는 그대로다(문서 표시만 제외 — 일지·급여 데이터 무손실).
//
// 실행: npx tsx scripts/verify-attendance-holiday.mts

import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

import { PrismaClient } from "@prisma/client";
import { assertWritableDb } from "./_dbGuard.mts";

// ★.mts(ESM) → lib/*.ts(CJS) 인터롭(리포 전역 조건).
import * as payloadNs from "../lib/docs/attendanceSheetPayload";
type PayloadModule = typeof import("../lib/docs/attendanceSheetPayload");
const P = (payloadNs as unknown as { default?: PayloadModule }).default ?? (payloadNs as unknown as PayloadModule);

assertWritableDb("출근부 휴무일 검증(테스트 자원 생성·삭제)");

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const STAMP = Date.now().toString(36);
const START = "2026-08-03", END = "2026-08-07";   // 월~금 5일
const HOLIDAY = "2026-08-05";                      // 수요일을 휴무일로
const DAYS = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
const made = {
  agencyId: null as bigint | null, siteId: null as bigint | null, workerId: null as bigint | null,
  assignmentId: null as bigint | null, assignment2Id: null as bigint | null, site2Id: null as bigint | null,
};

const SIGS = {
  govAgent: { name: "", imageUrl: undefined },
  companyManager: { name: "", imageUrl: undefined },
  worker: { name: "", imageUrl: undefined },
};

type Entry = { date: string; hours: number };
type Built = { payload: { entries: Entry[]; totalDays: number; totalHours: number; oneToOneHours: number; holidays: string[] } };

async function build(siteId: bigint, workerId: bigint) {
  return (await P.buildAttendanceSheetPayload({
    workerId, start: START, end: END, siteId,
    companyName: "휴무검증사업체", workerName: "이지도", workerPhone: "010-0000-0000",
    fallbackAssignment: {
      workType: "FULL_DAY", commuteGuidanceIncluded: true,
      customWorkStart: null, customWorkEnd: null, attendanceButtonExempt: true,
    },
    signatures: SIGS,
  })) as unknown as Built;
}

async function main() {
  console.log("\n[셋업] 기관·사업체·워커·배정·출근부 5일");
  const agency = await prisma.agency.create({ data: { name: `휴무검증기관-${STAMP}` }, select: { id: true } });
  made.agencyId = agency.id;
  const site = await prisma.site.create({
    data: {
      companyName: `휴무검증사업체-${STAMP}`, address: "서울 중구 세종대로 110",
      gpsLat: "37.5663", gpsLon: "126.9779", agencyId: agency.id,
    },
    select: { id: true },
  });
  made.siteId = site.id;
  const worker = await prisma.worker.create({
    data: {
      loginId: `hol-${STAMP}`, password: "x".repeat(60),
      workerName: "이지도", phoneNumber: `010${String(Date.now()).slice(-8)}`,
    },
    select: { id: true },
  });
  made.workerId = worker.id;
  const asg = await prisma.siteAssignment.create({
    data: {
      workerId: worker.id, siteId: site.id, agencyId: agency.id, workType: "FULL_DAY",
      status: "ACTIVE", attendanceButtonExempt: true,
      startDate: new Date(`${START}T00:00:00+09:00`), endDate: new Date(`${END}T00:00:00+09:00`),
    },
    select: { id: true },
  });
  made.assignmentId = asg.id;

  for (const d of DAYS) {
    await prisma.dailyAttendance.create({
      data: {
        workerId: worker.id, siteId: site.id, assignmentId: asg.id, workDate: d,
        startTime: new Date(`${d}T09:00:00+09:00`), endTime: new Date(`${d}T18:00:00+09:00`), status: "DONE",
      },
    });
  }
  console.log(`  기관 ${agency.id} · 사업체 ${site.id} · 워커 ${worker.id} · 배정 ${asg.id} · 출근부 ${DAYS.length}일`);

  console.log("\n[1] ★양성 대조 — 휴무일 등록 전에는 그 날짜가 들어 있다");
  const before = await build(site.id, worker.id);
  const beforeDates = before.payload.entries.map((e) => e.date);
  ok("5일 전부 포함", beforeDates.length === 5, beforeDates.join(","));
  ok(`${HOLIDAY} 포함(감지기 생존)`, beforeDates.includes(HOLIDAY));
  ok("totalDays = 5", before.payload.totalDays === 5, String(before.payload.totalDays));
  const beforeHours = before.payload.totalHours;
  ok("totalHours > 0", beforeHours > 0, String(beforeHours));

  console.log("\n[2] 휴무일 등록(countAsWorkday=false) → 그 날짜 제외");
  const hol = await prisma.siteHoliday.create({
    data: { assignmentId: asg.id, date: HOLIDAY, reason: "사업체 휴무", countAsWorkday: false },
    select: { id: true },
  });
  const after = await build(site.id, worker.id);
  const afterDates = after.payload.entries.map((e) => e.date);
  ok(`${HOLIDAY} 제외됨`, !afterDates.includes(HOLIDAY), afterDates.join(","));
  ok(
    "나머지 4일은 그대로",
    afterDates.length === 4 && DAYS.filter((d) => d !== HOLIDAY).every((d) => afterDates.includes(d)),
    afterDates.join(","),
  );
  ok("totalDays = 4", after.payload.totalDays === 4, String(after.payload.totalDays));
  ok("totalHours 감소", after.payload.totalHours < beforeHours, `${beforeHours} → ${after.payload.totalHours}`);
  ok(
    "oneToOneHours 감소",
    after.payload.oneToOneHours < before.payload.oneToOneHours,
    `${before.payload.oneToOneHours} → ${after.payload.oneToOneHours}`,
  );

  console.log("\n[3] ★DailyAttendance 행은 삭제되지 않는다(문서 표시만 제외)");
  const rowCount = await prisma.dailyAttendance.count({ where: { assignmentId: asg.id } });
  ok("출근 행 5건 유지", rowCount === 5, String(rowCount));
  const holRow = await prisma.dailyAttendance.findFirst({
    where: { assignmentId: asg.id, workDate: HOLIDAY }, select: { id: true },
  });
  ok("휴무일 당일 행 존재", !!holRow);

  console.log("\n[4] countAsWorkday=true(근무 인정일)는 제외하지 않는다");
  await prisma.siteHoliday.update({ where: { id: hol.id }, data: { countAsWorkday: true } });
  const asWorkday = await build(site.id, worker.id);
  const wDates = asWorkday.payload.entries.map((e) => e.date);
  ok(`${HOLIDAY} 다시 포함`, wDates.includes(HOLIDAY), wDates.join(","));
  ok("totalDays = 5", asWorkday.payload.totalDays === 5, String(asWorkday.payload.totalDays));
  await prisma.siteHoliday.update({ where: { id: hol.id }, data: { countAsWorkday: false } });

  console.log("\n[4-1] ★payload.holidays — 출근부에 '휴무'로 찍을 날짜가 실려 나온다");
  const marked = await build(site.id, worker.id);
  ok(`${HOLIDAY} 가 holidays 에 포함`, marked.payload.holidays.includes(HOLIDAY), JSON.stringify(marked.payload.holidays));
  ok("★제외와 표기가 동시에 성립(entries 에는 없고 holidays 에는 있다)",
    !marked.payload.entries.some((e) => e.date === HOLIDAY) && marked.payload.holidays.includes(HOLIDAY));
  ok("근무일은 holidays 에 들어가지 않는다",
    !marked.payload.holidays.includes("2026-08-03"), JSON.stringify(marked.payload.holidays));
  // 광복절(2026-08-15)은 기간(08-03~08-07) 밖 — 공휴일이 기간을 넘어 새지 않는지.
  ok("기간 밖 공휴일은 실리지 않는다", !marked.payload.holidays.includes("2026-08-15"));

  console.log("\n[5] ★배정 격리 — 같은 워커의 다른 배정 휴무일은 이 출근부에 영향 없음");
  const site2 = await prisma.site.create({
    data: {
      companyName: `휴무검증사업체2-${STAMP}`, address: "서울 중구 세종대로 110",
      gpsLat: "37.5663", gpsLon: "126.9779", agencyId: agency.id,
    },
    select: { id: true },
  });
  made.site2Id = site2.id;
  const asg2 = await prisma.siteAssignment.create({
    data: {
      workerId: worker.id, siteId: site2.id, agencyId: agency.id, workType: "FULL_DAY",
      status: "ACTIVE", attendanceButtonExempt: true,
      startDate: new Date(`${START}T00:00:00+09:00`), endDate: new Date(`${END}T00:00:00+09:00`),
    },
    select: { id: true },
  });
  made.assignment2Id = asg2.id;
  // 다른 배정에 '나머지 날짜 전부'를 휴무로 등록 — 이게 새면 1번 현장 출근부가 텅 빈다.
  for (const d of DAYS.filter((x) => x !== HOLIDAY)) {
    await prisma.siteHoliday.create({ data: { assignmentId: asg2.id, date: d, countAsWorkday: false } });
  }
  const isolated = await build(site.id, worker.id);
  ok("다른 배정 휴무일 무영향(4일 유지)", isolated.payload.entries.length === 4, String(isolated.payload.entries.length));

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
}

async function cleanup() {
  console.log("\n[정리] 생성 시 보관한 id 로만 삭제");
  const asgIds = [made.assignmentId, made.assignment2Id].filter(Boolean) as bigint[];
  const siteIds = [made.siteId, made.site2Id].filter(Boolean) as bigint[];
  try {
    for (const id of asgIds) {
      await prisma.siteHoliday.deleteMany({ where: { assignmentId: id } });
      await prisma.dailyAttendance.deleteMany({ where: { assignmentId: id } });
      await prisma.siteAssignment.deleteMany({ where: { id } });
    }
    if (siteIds.length) await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
    if (made.workerId) await prisma.worker.deleteMany({ where: { id: made.workerId } });
    if (made.agencyId) await prisma.agency.deleteMany({ where: { id: made.agencyId } });
  } catch (e) {
    console.log(`  ⚠️ 정리 실패: ${(e as Error).message}`);
  }
  // ★"정리 완료" 출력을 믿지 않는다 — 조회로 재확인.
  const left = {
    agency: made.agencyId ? await prisma.agency.count({ where: { id: made.agencyId } }) : 0,
    site: siteIds.length ? await prisma.site.count({ where: { id: { in: siteIds } } }) : 0,
    worker: made.workerId ? await prisma.worker.count({ where: { id: made.workerId } }) : 0,
    attendance: asgIds.length ? await prisma.dailyAttendance.count({ where: { assignmentId: { in: asgIds } } }) : 0,
    holiday: asgIds.length ? await prisma.siteHoliday.count({ where: { assignmentId: { in: asgIds } } }) : 0,
  };
  const total = left.agency + left.site + left.worker + left.attendance + left.holiday;
  console.log(`  잔여: ${JSON.stringify(left)} → ${total === 0 ? "0 ✅" : "★잔여 있음 ❌"}`);
  return total;
}

let leftover = 0;
try {
  await main();
} catch (e) {
  fail++;
  console.log(`\n❌ 예외: ${(e as Error).stack}`);
} finally {
  leftover = await cleanup();
  await prisma.$disconnect();
}
process.exit(fail === 0 && leftover === 0 ? 0 : 1);
