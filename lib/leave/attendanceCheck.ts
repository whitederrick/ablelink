// lib/leave/attendanceCheck.ts
// 출근부 발송 교차검증(사용자 확정 정책): "출근 기록 없는 소정근로일 ⓐ" vs "등록 연차 사용 ⓑ"를 대조해
// ⓐ>ⓑ면 경고(미등록 연차가 '월차 0회'로 공단에 나가는 조용한 오기재 방지). 소프트 게이트 — 매니저 확인 후 발송.
// 데이터 조립 규칙은 연차 발생 배치(runAccrual)와 동일: 근무요일 Set·법정+커스텀휴무 제외·계약 미커버일 제외·
// '출근기록 존재' 기준. ★급여엔진·absentDays는 사용하지 않는다(변경 금지 목록).

import { prisma } from "@/lib/prisma";
import { getKrHolidays } from "@/lib/krHolidays";
import { resolveWorkingWeekdaySet } from "@/lib/payroll/weekdays";
import { judgePerfectAttendance, addDaysISO } from "@/lib/leave/accrual";

const isoOf = (d: Date) => d.toISOString().slice(0, 10);

export type LeaveAttendanceCheck = {
  emptyScheduledDays: string[]; // 출근 기록 없는 소정근로일(ⓐ)
  leaveDays: number;            // 그 기간 등록 연차 사용 일수 합(ⓑ)
  mismatch: boolean;            // ⓐ(일수 기준) > ⓑ
};

/** 기간 내 '출근 기록 없는 소정근로일'과 등록 연차를 대조. 계약이 없으면 판정 불가 → 경고 없음(무소음). */
export async function checkLeaveVsAttendance(args: {
  agencyId: bigint; workerId: bigint; siteId: bigint; start: string; end: string; // YYYY-MM-DD
}): Promise<LeaveAttendanceCheck> {
  const { agencyId, workerId, siteId, start, end } = args;

  const [contracts, attRows, holRows, useAgg] = await Promise.all([
    prisma.employmentContract.findMany({
      where: { agencyId, workerId },
      orderBy: { contractStart: "desc" },
      select: {
        contractStart: true, contractEnd: true,
        workDaysPerWeek: true, weeklyHoliday: true, workingWeekdays: true,
      },
    }),
    prisma.dailyAttendance.findMany({
      // 이 현장 출근만(출근부와 동일 스코프) — 멀티현장 타현장 출근이 이 현장 공백을 가리지 않게.
      where: { workerId, siteId, workDate: { gte: start, lte: end }, startTime: { not: null } },
      select: { workDate: true },
    }),
    prisma.siteHoliday.findMany({
      where: { assignment: { workerId, agencyId }, countAsWorkday: false, date: { gte: start, lte: end } },
      select: { date: true },
    }),
    prisma.annualLeaveEntry.aggregate({
      where: {
        agencyId, workerId, kind: "USE",
        effectiveDate: { gte: new Date(`${start}T00:00:00.000Z`), lte: new Date(`${end}T00:00:00.000Z`) },
      },
      _sum: { days: true },
    }),
  ]);
  const leaveDays = Math.round(Math.abs(Number(useAgg._sum.days ?? 0)) * 100) / 100;

  // 기간에 걸치는 최신 계약 — 없으면 소정근로일 판정 불가(경고 생략).
  const contract = contracts.find((c) => isoOf(c.contractStart) <= end && isoOf(c.contractEnd) >= start) ?? null;
  if (!contract) return { emptyScheduledDays: [], leaveDays, mismatch: false };

  const weekdaySet = resolveWorkingWeekdaySet(contract.workingWeekdays, contract.workDaysPerWeek, contract.weeklyHoliday);
  // 제외 집합 = 법정공휴일(걸치는 월) + 커스텀휴무 + 계약 미커버일
  const excluded = new Set<string>(holRows.map((r) => r.date));
  {
    let [y, m] = start.split("-").map(Number);
    const [ey, em] = end.split("-").map(Number);
    while (y < ey || (y === ey && m <= em)) {
      for (const d of Object.keys(getKrHolidays(y, m))) excluded.add(d);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  for (let iso = start; iso <= end; iso = addDaysISO(iso, 1)) {
    const covered = contracts.some((c) => isoOf(c.contractStart) <= iso && iso <= isoOf(c.contractEnd));
    if (!covered) excluded.add(iso);
  }

  const judge = judgePerfectAttendance({
    periodStart: start, periodEnd: end,
    workingWeekdays: weekdaySet, holidaySet: excluded,
    attendanceDates: new Set(attRows.map((r) => r.workDate)),
  });
  return {
    emptyScheduledDays: judge.missing,
    leaveDays,
    mismatch: judge.missing.length > leaveDays,
  };
}
