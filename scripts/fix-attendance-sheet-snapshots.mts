// scripts/fix-attendance-sheet-snapshots.mts
// 이미 제출된 출근부(DocumentVersion.sourceData 스냅샷)를 2026-06-18 새 규칙으로 재계산해 갱신한다.
//  · 일별/총계 = 근무형태 인정시간(전일 8h, 오전/오후 4.5~5.5h), 1:1↔1:多 = 현장 배정 훈련생 수로 택1,
//    연장 = 퇴근시각 자동(전일 저녁식사 1h 제외)·면제 배정은 일지 수동입력.
//  · 앱과 동일 헬퍼(dailyDocTimes·overtimeMinutesForDay·isPayrollPending) 재사용 → 결과 일치.
//  · 서명/이름 등 나머지 스냅샷 필드는 보존하고 숫자 필드만 덮어쓴다.
//
// 실행:
//   npx tsx scripts/fix-attendance-sheet-snapshots.mts            (드라이런: 변경 미리보기만)
//   npx tsx scripts/fix-attendance-sheet-snapshots.mts --apply    (실제 갱신)
//   ... --include-submitted   (공단 제출(govStatus=SUBMITTED)분도 포함. 기본은 제외)
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

import { PrismaClient } from "@prisma/client";
import { dailyDocTimes } from "@/lib/pdf/dailyDocTimes";
import { overtimeMinutesForDay } from "@/lib/attendance/overtime";
import { isPayrollPending } from "@/lib/attendance/payrollGate";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const INCLUDE_SUBMITTED = process.argv.includes("--include-submitted");

function fmtHHMM(d: Date): string {
  const kst = new Date(d.getTime() + 9 * 3600000);
  return `${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}
const ymd = (d: Date) => new Date(d).toISOString().slice(0, 10);

async function main() {
  const runs = await prisma.documentRun.findMany({
    where: { docType: "ATTENDANCE_SHEET", ...(INCLUDE_SUBMITTED ? {} : { govStatus: { not: "SUBMITTED" } }) },
    select: {
      id: true, workerId: true, assignmentId: true, periodStart: true, periodEnd: true, govStatus: true,
      assignment: { select: { workType: true, commuteGuidanceIncluded: true, customWorkStart: true, customWorkEnd: true, attendanceButtonExempt: true, siteId: true } },
      versions: { select: { id: true, sourceData: true } },
    },
  });

  console.log(`📋 대상 출근부 run: ${runs.length}건 (공단 제출분 ${INCLUDE_SUBMITTED ? "포함" : "제외"})`);
  console.log(APPLY ? "⚠️  --apply: 실제 갱신합니다." : "🔍 드라이런(미적용). 실제 반영하려면 --apply 추가.\n");

  let runCnt = 0, verCnt = 0;
  for (const run of runs) {
    const a = run.assignment;
    if (!a) { console.warn(`  · 스킵(배정 없음): run#${run.id}`); continue; }

    const start = ymd(run.periodStart);
    const end = ymd(run.periodEnd);
    const docTimes = dailyDocTimes(a.workType, a.commuteGuidanceIncluded, a.customWorkStart, a.customWorkEnd);
    const recognizedHours = docTimes.measHours;

    const traineeCount = await prisma.traineePlacement.count({
      where: {
        siteId: a.siteId, status: "ACTIVE",
        startDate: { lte: new Date(end + "T23:59:59+09:00") },
        OR: [{ endDate: null }, { endDate: { gte: new Date(start + "T00:00:00+09:00") } }],
      },
    });
    const isMulti = traineeCount >= 2;

    const attendances = await prisma.dailyAttendance.findMany({
      where: { workerId: run.workerId, workDate: { gte: start, lte: end } },
      include: { logs: { select: { extTime1on1: true, extTimeGroup: true } } },
      orderBy: { workDate: "asc" },
    });

    const entries = attendances.map((att) => {
      const missedClockOut = !att.endTime && !(a.attendanceButtonExempt ?? false);
      const pending = missedClockOut || isPayrollPending({
        actualStartTime: att.actualStartTime ?? null,
        actualEndTime: att.actualEndTime ?? null,
        payrollConfirmedAt: att.payrollConfirmedAt ?? null,
        workType: a.workType ?? null,
        commuteGuidanceIncluded: a.commuteGuidanceIncluded ?? null,
        customWorkStart: a.customWorkStart ?? null,
        customWorkEnd: a.customWorkEnd ?? null,
        exempt: a.attendanceButtonExempt ?? false,
      });
      const baseH = pending ? 0 : recognizedHours;
      const extH = pending ? 0 : +(overtimeMinutesForDay({
        workType: a.workType, exempt: a.attendanceButtonExempt, actualEndTime: att.actualEndTime,
        commuteGuidanceIncluded: a.commuteGuidanceIncluded, customWorkStart: a.customWorkStart, customWorkEnd: a.customWorkEnd,
        manualExtHours: att.logs.reduce((s, l) => s + Number(l.extTime1on1) + Number(l.extTimeGroup), 0),
      }) / 60).toFixed(2);
      return {
        date: att.workDate,
        start: pending ? "" : (att.startTime ? fmtHHMM(att.startTime) : ""),
        end: pending ? "" : (att.endTime ? fmtHHMM(att.endTime) : ""),
        pending,
        hours: baseH,
        multiHours: isMulti ? baseH : 0,
        _ext: extH,
      };
    });
    const baseTotal = entries.reduce((s, e) => s + Number(e.hours), 0);
    const extTotal = entries.reduce((s, e) => s + Number(e._ext), 0);

    const patch = {
      totalDays: entries.length,
      totalHours: baseTotal + extTotal,
      oneToOneHours: isMulti ? 0 : baseTotal,
      oneToManyHours: isMulti ? baseTotal : 0,
      otOneToOneHours: isMulti ? 0 : extTotal,
      otOneToManyHours: isMulti ? extTotal : 0,
      entries: entries.map(({ _ext, ...e }) => e),
    };

    runCnt++;
    const before = (run.versions[0]?.sourceData as any) ?? {};
    console.log(`run#${run.id} [${start}~${end}] 훈련생 ${traineeCount}명(${isMulti ? "1:多" : "1:1"}) · 일수 ${patch.totalDays} · 총 ${patch.totalHours}h (이전 총 ${before.totalHours ?? "?"}h)`);

    for (const v of run.versions) {
      const merged = { ...((v.sourceData ?? {}) as any), ...patch };
      verCnt++;
      if (APPLY) {
        await prisma.documentVersion.update({ where: { id: v.id }, data: { sourceData: merged } });
      }
    }
  }

  console.log(`\n${APPLY ? "✅ 갱신 완료" : "🔍 드라이런 종료"}: run ${runCnt}건 · version ${verCnt}건`);
  if (!APPLY) console.log("실제 반영: npx tsx scripts/fix-attendance-sheet-snapshots.mts --apply");
}

main().catch((e) => { console.error("실패:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
