// app/api/worker/attendance/bulk-generate/route.ts
// 출퇴근 버튼 없이 기간 일괄 출근부 자동생성 (시프티 병행 편의 기능)
// POST { from: "YYYY-MM-DD", to: "YYYY-MM-DD", assignmentId? }
//  - 주말 + 한국 공휴일 + 등록된 커스텀 휴무일(SiteHoliday) 자동 제외
//  - 평일에 대해 근무형태별 표준 출퇴근 시각으로 DailyAttendance 일괄 생성(이미 있으면 건너뜀)

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKstDateString } from "@/lib/time";
import { getKrHolidays } from "@/lib/krHolidays";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";
import { getWorkerSessionFromReq } from "@/app/worker/_lib/session";
import { audit } from "@/lib/audit";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 100; // 과도한 일괄 생성 방지

function toBigIntOrNull(v: any): bigint | null {
  const s = String(v ?? "").trim();
  if (!/^[0-9]+$/.test(s)) return null;
  return BigInt(s);
}

// "YYYY-MM-DD" → 요일(0=일 ... 6=토). 날짜 전용이라 UTC 기준으로 안전 계산.
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// from~to(포함) 날짜 문자열 배열
function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 24 * 60 * 60 * 1000;
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getWorkerSessionFromReq(request);
    if (!session) {
      return NextResponse.json({ success: false, message: "인증이 필요합니다." }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const from = String(body?.from ?? "").trim();
    const to = String(body?.to ?? "").trim();

    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
      return NextResponse.json(
        { success: false, message: "기간(시작일/종료일)을 YYYY-MM-DD 형식으로 입력해주세요." },
        { status: 400 },
      );
    }
    if (from > to) {
      return NextResponse.json({ success: false, message: "시작일이 종료일보다 늦습니다." }, { status: 400 });
    }

    // 미래 날짜에는 출근부를 생성하지 않음(오늘 이후는 잘라냄)
    const todayStr = getKstDateString();
    const effectiveTo = to > todayStr ? todayStr : to;
    if (from > effectiveTo) {
      return NextResponse.json(
        { success: false, message: "생성 가능한 날짜가 없습니다. (미래 날짜는 제외됩니다)" },
        { status: 400 },
      );
    }

    const allDates = enumerateDates(from, effectiveTo);
    if (allDates.length > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { success: false, message: `한 번에 최대 ${MAX_RANGE_DAYS}일까지 생성할 수 있습니다.` },
        { status: 400 },
      );
    }

    const workerIdBig = BigInt(session.workerId);
    const validStatuses = ["ASSIGNED", "CONFIRMED", "ACTIVE"] as const;

    // 배정 결정: 입력된 assignmentId(내 것) 우선, 없으면 최신 유효 배정
    const inputAssignmentId = toBigIntOrNull(body?.assignmentId);
    const assignment = inputAssignmentId
      ? await prisma.siteAssignment.findFirst({
          where: { id: inputAssignmentId, workerId: workerIdBig, status: { in: [...validStatuses] } },
        })
      : await prisma.siteAssignment.findFirst({
          where: { workerId: workerIdBig, status: { in: [...validStatuses] } },
          orderBy: [{ startDate: "desc" }, { id: "desc" }],
        });

    if (!assignment) {
      return NextResponse.json({ success: false, message: "배정된 현장이 없습니다." }, { status: 404 });
    }

    // 출퇴근 버튼 면제(자동기록·시프티 병행) 배정만 일괄 작성 허용.
    // 일반 배정은 출퇴근 버튼으로 기록해야 하므로 서버에서도 차단(UI 비노출 + 이중 방어).
    if (!assignment.attendanceButtonExempt) {
      return NextResponse.json(
        { success: false, message: "이 현장은 출퇴근 버튼으로 기록하는 배정입니다. 일괄 작성 대상이 아닙니다." },
        { status: 403 },
      );
    }

    const times = computeWorkTimes(
      assignment.workType,
      assignment.commuteGuidanceIncluded,
      assignment.customWorkStart,
      assignment.customWorkEnd,
    );

    // 한국 공휴일 집합(범위 내 모든 달)
    const krHolidaySet = new Set<string>();
    {
      const seen = new Set<string>();
      for (const d of allDates) {
        const ym = d.slice(0, 7);
        if (seen.has(ym)) continue;
        seen.add(ym);
        const [y, m] = ym.split("-").map(Number);
        for (const hd of Object.keys(getKrHolidays(y, m))) krHolidaySet.add(hd);
      }
    }

    // 등록된 커스텀 휴무일(SiteHoliday) 집합 — countAsWorkday=false(실제 휴무)만 스킵.
    // (countAsWorkday=true는 근무 인정일이므로 출근부 생성 대상 — cron/daily와 동일 기준)
    const customHolidayRows = await prisma.siteHoliday.findMany({
      where: { assignmentId: assignment.id, date: { gte: from, lte: effectiveTo }, countAsWorkday: false },
      select: { date: true },
    });
    const customHolidaySet = new Set(customHolidayRows.map((r) => r.date));

    // 이미 출근부가 있는 날짜
    const existingRows = await prisma.dailyAttendance.findMany({
      where: { assignmentId: assignment.id, workDate: { gte: from, lte: effectiveTo } },
      select: { workDate: true },
    });
    const existingSet = new Set(existingRows.map((r) => r.workDate));

    // 배정 기간(startDate~endDate)으로 범위 제한 — 배정 시작 전/종료 후 날짜가 출근부·급여에 들어가지 않도록.
    const asgStart = assignment.startDate ? getKstDateString(assignment.startDate) : null;
    const asgEnd = assignment.endDate ? getKstDateString(assignment.endDate) : null;

    // 후보 산정
    const skipped = { weekend: 0, krHoliday: 0, customHoliday: 0, existing: 0, outOfRange: 0 };
    const targets: string[] = [];
    for (const date of allDates) {
      if ((asgStart && date < asgStart) || (asgEnd && date > asgEnd)) { skipped.outOfRange++; continue; }
      const wd = weekdayOf(date);
      if (wd === 0 || wd === 6) { skipped.weekend++; continue; }
      if (krHolidaySet.has(date)) { skipped.krHoliday++; continue; }
      if (customHolidaySet.has(date)) { skipped.customHoliday++; continue; }
      if (existingSet.has(date)) { skipped.existing++; continue; }
      targets.push(date);
    }

    let created = 0;
    if (targets.length > 0) {
      const result = await prisma.dailyAttendance.createMany({
        data: targets.map((date) => ({
          workerId: workerIdBig,
          siteId: assignment.siteId,
          assignmentId: assignment.id,
          workDate: date,
          startTime: kstWallTimeToInstant(date, times.start),
          endTime: kstWallTimeToInstant(date, times.end),
          status: "DONE" as const,
        })),
        skipDuplicates: true,
      });
      created = result.count;
    }

    if (created > 0) {
      await audit(session, { entityType: "DailyAttendance", action: "createMany", summary: `출근부 일괄생성 ${created}건 (${from}~${effectiveTo})` });
    }

    return NextResponse.json({
      success: true,
      message:
        created > 0
          ? `${created}일의 출근부가 생성되었습니다.`
          : "새로 생성된 출근부가 없습니다. (이미 작성되었거나 휴무/주말)",
      created,
      skipped,
      range: { from, to: effectiveTo },
      workTimes: times,
    });
  } catch (error) {
    console.error("출근부 일괄생성 에러:", error);
    return NextResponse.json({ success: false, message: "서버 오류" }, { status: 500 });
  }
}
