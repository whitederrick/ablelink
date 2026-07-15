// lib/leave/runAccrual.ts
// 연차 자동 발생·소멸 배치(cron/daily에서 격리 호출). 판정은 lib/leave/accrual(순수) 위임 — 여기는 데이터 조립.
//
// 멱등: 모든 자동 행에 dedupKey(unique) — 월개근 "am:{agencyId}:{workerId}:{구간}", 연 "ay:...:{n}",
//  소멸 "ex:{부여행id}". createMany({skipDuplicates:true})라 재실행·겹침 실행에도 중복 없음.
// 스코프: 개근·출근은 '그 기관' 배정의 출근만 센다(assignment.agencyId — 같은 사업주 아래 멀티현장은
//  하나의 근로계약이므로 합산되고, 타 기관 근로는 이 계약의 개근과 무관).
// 계약 인정 기준: computeRun과 동일하게 status 무필터·최초 contractStart=입사일(계속근로 판정 정합).
// ★급여엔진(computeRun)·주휴/일할 로직은 일절 건드리지 않는다(읽기 전용 데이터 조립만).

import { prisma } from "@/lib/prisma";
import { getKrHolidays } from "@/lib/krHolidays";
import { resolveWorkingWeekdaySet } from "@/lib/payroll/weekdays";
import {
  monthlyAccrualPeriods, annualAccrualsUpTo, expiryDateOf, judgePerfectAttendance,
  attendanceRateSatisfied, isLeaveExcluded, expiryCandidates, addDaysISO, addMonthsClamped,
  type LedgerEntry,
} from "@/lib/leave/accrual";

const cMin = (t?: string | null) => { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const isoOf = (d: Date) => d.toISOString().slice(0, 10); // 계약일자 관례: 날짜 = UTC 자정
const utcMidnight = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

type ContractRow = {
  contractStart: Date; contractEnd: Date;
  workStartTime: string | null; workEndTime: string | null; breakStartTime: string | null; breakEndTime: string | null;
  workDaysPerWeek: number | null; weeklyHoliday: string | null; workingWeekdays: string | null;
};

/** 구간에 걸치는 계약 중 최신(contractStart desc) — computeRun의 '급여월 겹침 최신'과 동일 선택 규칙. */
function contractFor(contracts: ContractRow[], startISO: string, endISO: string): ContractRow | null {
  let best: ContractRow | null = null;
  for (const c of contracts) {
    if (isoOf(c.contractStart) > endISO || isoOf(c.contractEnd) < startISO) continue;
    if (!best || c.contractStart > best.contractStart) best = c;
  }
  return best;
}

/** 구간 내 '계약 미커버 날짜'(어느 계약 기간에도 안 속함) — 소정근로일에서 제외(중도 입·퇴사 구간 방어). */
function uncoveredDates(contracts: ContractRow[], startISO: string, endISO: string): string[] {
  const out: string[] = [];
  for (let iso = startISO; iso <= endISO; iso = addDaysISO(iso, 1)) {
    const covered = contracts.some((c) => isoOf(c.contractStart) <= iso && iso <= isoOf(c.contractEnd));
    if (!covered) out.push(iso);
  }
  return out;
}

/** 법정공휴일 집합(구간이 걸치는 모든 연-월). */
function krHolidaysBetween(startISO: string, endISO: string): Set<string> {
  const set = new Set<string>();
  let [y, m] = startISO.split("-").map(Number);
  const [ey, em] = endISO.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    for (const d of Object.keys(getKrHolidays(y, m))) set.add(d);
    m++; if (m > 12) { m = 1; y++; }
  }
  return set;
}

export type AccrualBatchResult = {
  accrued: number;   // 생성된 부여 행 수(월+연)
  expired: number;   // 생성된 소멸 행 수
  notices: number;   // 발송한 워커 알림 수
  errors: string[];
  detail: { accrued: { agencyId: string; workerId: string; kind: string; label: string; days: number }[]; expired: { workerId: string; days: number }[] };
};

/** 연차 자동 발생·소멸 1회 실행(멱등). now = 배치 시각. 판정 기준일 until = 어제(KST) — 출근부가 확정 흐름을 탄 날짜까지만. */
export async function runAnnualLeaveAccrualBatch(now: Date): Promise<AccrualBatchResult> {
  const res: AccrualBatchResult = { accrued: 0, expired: 0, notices: 0, errors: [], detail: { accrued: [], expired: [] } };
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayISO = kstNow.toISOString().slice(0, 10);
  const untilISO = addDaysISO(todayISO, -1);
  const freshSinceISO = addDaysISO(todayISO, -7); // 알림은 최근 발생분만(과거 백필은 무음)

  // 활성 기관의 (기관, 워커) 계약 페어 — 연차는 근로계약 단위 권리.
  const activeAgencies = await prisma.agency.findMany({ where: { isActive: true }, select: { id: true } });
  const activeAgencyIds = new Set(activeAgencies.map((a) => a.id.toString()));
  const pairs = await prisma.employmentContract.groupBy({ by: ["agencyId", "workerId"] });

  for (const pair of pairs) {
    if (!activeAgencyIds.has(pair.agencyId.toString())) continue;
    const agencyId = pair.agencyId, workerId = pair.workerId;
    try {
      const contracts: ContractRow[] = await prisma.employmentContract.findMany({
        where: { agencyId, workerId },
        orderBy: { contractStart: "asc" },
        select: {
          contractStart: true, contractEnd: true,
          workStartTime: true, workEndTime: true, breakStartTime: true, breakEndTime: true,
          workDaysPerWeek: true, weeklyHoliday: true, workingWeekdays: true,
        },
      });
      if (contracts.length === 0) continue;
      const hireISO = isoOf(contracts[0].contractStart);

      const existing = await prisma.annualLeaveEntry.findMany({
        where: { agencyId, workerId },
        select: { id: true, kind: true, days: true, effectiveDate: true, expiresAt: true, dedupKey: true },
      });
      const dedupSet = new Set(existing.filter((e) => e.dedupKey).map((e) => e.dedupKey as string));
      const leaveDates = new Set(existing.filter((e) => e.kind === "USE").map((e) => isoOf(e.effectiveDate)));

      // 판정 후보 수집(미기록 구간만) — 데이터 조회 범위 최소화를 위해 먼저 목록화.
      const monthly = monthlyAccrualPeriods(hireISO, untilISO).filter((p) => !dedupSet.has(`am:${agencyId}:${workerId}:${p.label}`));
      const annual = annualAccrualsUpTo(hireISO, untilISO).filter((a) => !dedupSet.has(`ay:${agencyId}:${workerId}:${a.anniversaryYears}`));
      const needJudge = monthly.length > 0 || annual.length > 0;

      const toCreate: {
        agencyId: bigint; workerId: bigint; kind: "ACCRUAL_MONTHLY" | "ACCRUAL_ANNUAL"; days: number;
        effectiveDate: Date; expiresAt: Date; sourceLabel: string; dedupKey: string;
      }[] = [];

      if (needJudge) {
        // 조회 범위 = 필요한 구간 전체(연 트랙은 직전 1년 포함).
        const spanStartISO = [
          ...monthly.map((p) => p.start),
          ...annual.map((a) => addDaysISO(addDaysISO(a.accrualDate, -365), -1)),
        ].sort()[0];
        const spanEndISO = untilISO;
        const [attRows, holRows] = await Promise.all([
          prisma.dailyAttendance.findMany({
            // '출근 기록 존재'(startTime 有) — 확정 불문·지각/보정대기 포함(주휴 개근 노무사 #3과 동일 기준).
            where: { workerId, assignment: { agencyId }, workDate: { gte: spanStartISO, lte: spanEndISO }, startTime: { not: null } },
            select: { workDate: true },
          }),
          prisma.siteHoliday.findMany({
            where: { assignment: { workerId, agencyId }, countAsWorkday: false, date: { gte: spanStartISO, lte: spanEndISO } },
            select: { date: true },
          }),
        ]);
        const attendanceDates = new Set(attRows.map((r) => r.workDate));
        const customHolidays = holRows.map((r) => r.date);

        // ── 1년 미만: 월 개근 1일 ──
        for (const p of monthly) {
          const contract = contractFor(contracts, p.start, p.end);
          if (!contract) continue; // 구간에 유효 계약 없음 = 발생 없음
          const weekdaySet = resolveWorkingWeekdaySet(contract.workingWeekdays, contract.workDaysPerWeek, contract.weeklyHoliday);
          const _cs = cMin(contract.workStartTime), _ce = cMin(contract.workEndTime), _cbs = cMin(contract.breakStartTime), _cbe = cMin(contract.breakEndTime);
          const dailySoje = (_cs != null && _ce != null && _ce > _cs)
            ? Math.max(0, (_ce - _cs) - (_cbs != null && _cbe != null && _cbe > _cbs ? _cbe - _cbs : 0))
            : null;
          if (isLeaveExcluded(dailySoje, weekdaySet.size)) continue; // 초단시간 §18③
          const excluded = new Set<string>([...krHolidaysBetween(p.start, p.end), ...customHolidays, ...uncoveredDates(contracts, p.start, p.end)]);
          const judge = judgePerfectAttendance({
            periodStart: p.start, periodEnd: p.end,
            workingWeekdays: weekdaySet, holidaySet: excluded, attendanceDates, leaveDates,
          });
          if (!judge.perfect) continue;
          toCreate.push({
            agencyId, workerId, kind: "ACCRUAL_MONTHLY", days: 1,
            effectiveDate: utcMidnight(p.accrualDate),
            expiresAt: utcMidnight(expiryDateOf("ACCRUAL_MONTHLY", hireISO, p.accrualDate)),
            sourceLabel: p.label, dedupKey: `am:${agencyId}:${workerId}:${p.label}`,
          });
        }

        // ── 1년 이상: n주년 15+가산(직전 1년 출근율 80%) ──
        for (const a of annual) {
          const yearStart = addMonthsClamped(a.accrualDate, -12); // 직전 연차년도(n-1주년~n주년 전날)
          const yearEnd = addDaysISO(a.accrualDate, -1);
          const contract = contractFor(contracts, yearStart, yearEnd);
          if (!contract) continue;
          const weekdaySet = resolveWorkingWeekdaySet(contract.workingWeekdays, contract.workDaysPerWeek, contract.weeklyHoliday);
          const _cs = cMin(contract.workStartTime), _ce = cMin(contract.workEndTime), _cbs = cMin(contract.breakStartTime), _cbe = cMin(contract.breakEndTime);
          const dailySoje = (_cs != null && _ce != null && _ce > _cs)
            ? Math.max(0, (_ce - _cs) - (_cbs != null && _cbe != null && _cbe > _cbs ? _cbe - _cbs : 0))
            : null;
          if (isLeaveExcluded(dailySoje, weekdaySet.size)) continue;
          const excluded = new Set<string>([...krHolidaysBetween(yearStart, yearEnd), ...customHolidays, ...uncoveredDates(contracts, yearStart, yearEnd)]);
          const judge = judgePerfectAttendance({
            periodStart: yearStart, periodEnd: yearEnd,
            workingWeekdays: weekdaySet, holidaySet: excluded, attendanceDates, leaveDates,
          });
          if (!attendanceRateSatisfied(judge)) continue;
          toCreate.push({
            agencyId, workerId, kind: "ACCRUAL_ANNUAL", days: a.days,
            effectiveDate: utcMidnight(a.accrualDate),
            expiresAt: utcMidnight(expiryDateOf("ACCRUAL_ANNUAL", hireISO, a.accrualDate)),
            sourceLabel: a.label, dedupKey: `ay:${agencyId}:${workerId}:${a.anniversaryYears}`,
          });
        }

        if (toCreate.length) {
          await prisma.annualLeaveEntry.createMany({ data: toCreate, skipDuplicates: true });
          res.accrued += toCreate.length;
          res.detail.accrued.push(...toCreate.map((c) => ({
            agencyId: String(c.agencyId), workerId: String(c.workerId), kind: c.kind, label: c.sourceLabel, days: c.days,
          })));
          // 알림(무료 앱내) — 최근 발생분만(백필 무음). 실패해도 배치 계속.
          const fresh = toCreate.filter((c) => isoOf(c.effectiveDate) >= freshSinceISO);
          if (fresh.length) {
            try {
              await prisma.workerNotice.createMany({
                data: fresh.map((c) => ({
                  workerId: c.workerId, agencyId: c.agencyId,
                  title: "연차 발생 안내",
                  body: c.kind === "ACCRUAL_MONTHLY"
                    ? `개근(${c.sourceLabel})으로 연차 1일이 발생했습니다.`
                    : `근속 ${c.sourceLabel}로 연차 ${c.days}일이 발생했습니다.`,
                  type: "INFO" as const,
                  link: "/worker/leave",
                })),
              });
              res.notices += fresh.length;
            } catch (e) { res.errors.push(`연차알림[${workerId}]: ${e instanceof Error ? e.message : String(e)}`); }
          }
        }
      }

      // ── 소멸(EXPIRE): 기한 지난 부여분의 미소진 잔량 — 부여행 id 기반 dedup로 멱등 ──
      const ledger: LedgerEntry[] = [
        ...existing.map((e) => ({
          id: e.id.toString(), kind: e.kind as LedgerEntry["kind"], days: Number(e.days),
          effectiveDate: isoOf(e.effectiveDate), expiresAt: e.expiresAt ? isoOf(e.expiresAt) : null,
        })),
        // 방금 만든 부여분 포함(가상 id: dedupKey — 오늘 만든 부여가 오늘 만료일인 병적 케이스 방어)
        ...toCreate.map((c) => ({
          id: c.dedupKey, kind: c.kind as LedgerEntry["kind"], days: c.days,
          effectiveDate: isoOf(c.effectiveDate), expiresAt: isoOf(c.expiresAt),
        })),
      ];
      const cands = expiryCandidates(ledger, todayISO).filter((c) => !dedupSet.has(`ex:${c.grantId}`));
      if (cands.length) {
        await prisma.annualLeaveEntry.createMany({
          data: cands.map((c) => ({
            agencyId, workerId, kind: "EXPIRE" as const, days: -c.expireDays,
            effectiveDate: utcMidnight(c.expiresAt), sourceLabel: `소멸(부여#${c.grantId})`,
            dedupKey: `ex:${c.grantId}`,
          })),
          skipDuplicates: true,
        });
        res.expired += cands.length;
        res.detail.expired.push(...cands.map((c) => ({ workerId: String(workerId), days: c.expireDays })));
      }
    } catch (e) {
      res.errors.push(`연차[${agencyId}:${workerId}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return res;
}
