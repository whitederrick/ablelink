// lib/leave/accrual.ts
// ★연차 발생·소멸 판정 순수 로직(근기법 §60·§18③ + 노무사 판정 #5). DB/타임존 의존 없음 — cron·API·테스트 공유.
//
// 정책(사용자 확정 2026-07-15):
//  · 발생 = cron 자동(1년 미만: 입사일 기준 1개월 개근 시 1일, 최대 11 / 1년 이상: n주년에 15+가산일).
//  · 개근 판정 = '출근 기록 존재' 기준(지각·보정대기 포함 — 주휴 개근의 노무사 #3 판정과 일관).
//  · 주 소정 15시간 미만(초단시간)은 연차 미적용(§18③).
//  · 급여엔진(computeRun)은 이 모듈을 모른다 — 수당 정산은 급여 확정 그리드 경유(무회귀 원칙).
//
// 날짜는 전부 "YYYY-MM-DD" 문자열(KST 벽시계 날짜)로 다룬다. DB DateTime(UTC 자정)과의 변환은 호출부 책임.

export type LeavePeriod = {
  seq: number;          // 0-base: 입사 후 n번째 월 구간
  start: string;        // 구간 시작(포함)
  end: string;          // 구간 끝(포함)
  accrualDate: string;  // 발생일 = end 다음날(구간 개근을 다 채운 날의 다음날)
  label: string;        // "2026-04-03~2026-05-02" — dedupKey·표시 공용
};

// ── 날짜 헬퍼(문자열 연산·UTC Date 경유로 DST/타임존 무관) ──────────────
function toUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDaysISO(iso: string, days: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}
/** iso + n개월. 기준일이 대상 월에 없으면 말일로 클램프(1/31 +1개월 = 2/28). */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const totalM = (m - 1) + months;
  const ty = y + Math.floor(totalM / 12);
  const tm = ((totalM % 12) + 12) % 12; // 0-base
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(ty, tm, Math.min(d, lastDay))));
}

// ── 1년 미만: 월 개근 구간 ─────────────────────────────────────────────
/**
 * 입사일 기준 월 구간(n번째 = 입사일+n개월 ~ +n+1개월-1일)을 until(포함)까지 '구간이 완결된 것만' 반환.
 * 최대 11개(입사 1년까지의 월개근분 — 근기법 §60② 한도). 12번째 월부터는 연 단위(ACCRUAL_ANNUAL) 트랙.
 */
export function monthlyAccrualPeriods(hireDateISO: string, untilISO: string): LeavePeriod[] {
  const out: LeavePeriod[] = [];
  for (let n = 0; n < 11; n++) {
    const start = addMonthsClamped(hireDateISO, n);
    const end = addDaysISO(addMonthsClamped(hireDateISO, n + 1), -1);
    if (end > untilISO) break; // 아직 완결되지 않은 구간
    out.push({ seq: n, start, end, accrualDate: addDaysISO(end, 1), label: `${start}~${end}` });
  }
  return out;
}

// ── 1년 이상: 연 단위 발생 ─────────────────────────────────────────────
/** n주년(n>=1) 발생 일수 = 15 + (3년차부터 매 2년당 1일 가산), 상한 25 (§60①·④). n=1,2→15 / 3,4→16 / 5,6→17 … */
export function annualAccrualDays(anniversaryYears: number): number {
  if (anniversaryYears < 1) return 0;
  return Math.min(15 + Math.floor((anniversaryYears - 1) / 2), 25);
}
/** until(포함)까지 도래한 n주년 발생 목록. */
export function annualAccrualsUpTo(hireDateISO: string, untilISO: string): { anniversaryYears: number; accrualDate: string; days: number; label: string }[] {
  const out: { anniversaryYears: number; accrualDate: string; days: number; label: string }[] = [];
  for (let n = 1; n <= 60; n++) {
    const accrualDate = addMonthsClamped(hireDateISO, n * 12);
    if (accrualDate > untilISO) break;
    out.push({ anniversaryYears: n, accrualDate, days: annualAccrualDays(n), label: `${n}주년` });
  }
  return out;
}

// ── 사용기한(소멸일) ───────────────────────────────────────────────────
/** 월개근분: 입사 1주년 전날까지 사용(§60⑦ — 최초 1년간). 연분: 발생일부터 1년. 반환 = '이 날부터 소멸'인 날짜. */
export function expiryDateOf(kind: "ACCRUAL_MONTHLY" | "ACCRUAL_ANNUAL", hireDateISO: string, accrualDateISO: string): string {
  if (kind === "ACCRUAL_MONTHLY") return addMonthsClamped(hireDateISO, 12);
  return addMonthsClamped(accrualDateISO, 12);
}

// ── 개근 판정 ─────────────────────────────────────────────────────────
export type PerfectAttendanceInput = {
  periodStart: string;
  periodEnd: string;
  /** 소정근로 요일 집합(0=일..6=토) — lib/payroll/weekdays.resolveWorkingWeekdaySet 결과를 그대로 전달. */
  workingWeekdays: Set<number>;
  /** 소정근로일에서 제외할 날짜(법정공휴일 + 현장 커스텀휴무 countAsWorkday=false). "YYYY-MM-DD". */
  holidaySet: Set<string>;
  /** 출근 기록이 존재하는 날짜들(확정 여부 무관 — 지각·보정대기 포함). "YYYY-MM-DD". */
  attendanceDates: Set<string>;
  /** 이미 등록된 연차 사용일(USE) — 출근으로 간주(연차 사용이 개근을 깨지 않게, §60⑥ 취지). */
  leaveDates?: Set<string>;
};
export type PerfectAttendanceResult = { scheduled: number; attended: number; missing: string[]; perfect: boolean };

/** 구간 개근 판정: 소정근로일(근무요일∩비공휴일) 전부에 출근(또는 연차 사용) 기록이 있는가.
 *  소정근로일이 0이면 perfect=false(발생 근거 없음 — 무근로 구간에 연차가 쌓이지 않게). */
export function judgePerfectAttendance(input: PerfectAttendanceInput): PerfectAttendanceResult {
  const { periodStart, periodEnd, workingWeekdays, holidaySet, attendanceDates, leaveDates } = input;
  const missing: string[] = [];
  let scheduled = 0, attended = 0;
  for (let iso = periodStart; iso <= periodEnd; iso = addDaysISO(iso, 1)) {
    const dow = toUTC(iso).getUTCDay();
    if (!workingWeekdays.has(dow)) continue;
    if (holidaySet.has(iso)) continue;
    scheduled++;
    if (attendanceDates.has(iso) || leaveDates?.has(iso)) attended++;
    else missing.push(iso);
  }
  return { scheduled, attended, missing, perfect: scheduled > 0 && missing.length === 0 };
}

/** 1년 이상 트랙의 '출근율 80%' 판정(§60① — 1년간 80% 이상 출근 시 15일). */
export function attendanceRateSatisfied(result: Pick<PerfectAttendanceResult, "scheduled" | "attended">): boolean {
  if (result.scheduled <= 0) return false;
  return result.attended / result.scheduled >= 0.8;
}

// ── 초단시간(주 15h 미만) 제외 §18③ ──────────────────────────────────
/** 주 소정근로시간(분) = 1일 소정(분) × 주 소정근로일수. 900분(15h) 미만이면 연차 미적용. */
export function isLeaveExcluded(dailySojeMinutes: number | null, workDaysPerWeek: number): boolean {
  if (dailySojeMinutes == null || dailySojeMinutes <= 0 || workDaysPerWeek <= 0) return false; // 판정 불가 시 제외하지 않음(보수적 — 부여 후 조정 가능)
  return dailySojeMinutes * workDaysPerWeek < 15 * 60;
}

// ── 원장 집계(FIFO) ────────────────────────────────────────────────────
export type LedgerEntry = {
  id: string;                      // 원장 행 id(문자열화)
  kind: "ACCRUAL_MONTHLY" | "ACCRUAL_ANNUAL" | "USE" | "EXPIRE" | "PAYOUT" | "ADJUST";
  days: number;                    // + 부여 / - 차감
  effectiveDate: string;           // "YYYY-MM-DD"
  expiresAt: string | null;
};
export type GrantState = { id: string; days: number; used: number; remaining: number; expiresAt: string | null };
export type LedgerState = { balance: number; grants: GrantState[] };

/** 원장 → 잔여·부여분별 소진 상태. 차감(-)은 부여분에 FIFO(발생일 오름차순) 배분.
 *  ADJUST(+)는 만료 없는 부여로, ADJUST(-)는 일반 차감으로 취급. 잔여 = 전체 부호합(배분과 무관하게 보존). */
export function computeLedgerState(entries: LedgerEntry[]): LedgerState {
  // 차감 배분 우선순위: ①만료임박(expiresAt 오름차순, 무만료 null은 후순위) ②만료일 동일 시 발생일 오름차순(FIFO) ③id.
  //  소멸로 잃기 쉬운 부여부터 소진해 워커 유리(만기 손실 방지). 통상 적립은 월개근분(이른 만료)이 연차분(늦은 만료)보다
  //  앞서 기존 '발생일순'과 결과가 같고, 무만료 ADJUST(+)가 이른 발생일을 가질 때만 후순위로 밀려 만료 부여를 먼저 소진한다.
  const grants: GrantState[] = entries
    .filter((e) => e.days > 0)
    .sort((a, b) => {
      if (a.expiresAt !== b.expiresAt) {
        if (a.expiresAt == null) return 1;
        if (b.expiresAt == null) return -1;
        return a.expiresAt < b.expiresAt ? -1 : 1;
      }
      if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    })
    .map((e) => ({ id: e.id, days: e.days, used: 0, remaining: e.days, expiresAt: e.expiresAt }));
  const debits = entries
    .filter((e) => e.days < 0)
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : a.id < b.id ? -1 : 1));
  for (const d of debits) {
    let rest = -d.days;
    for (const g of grants) {
      if (rest <= 0) break;
      if (g.remaining <= 0) continue;
      const take = Math.min(g.remaining, rest);
      g.used += take;
      g.remaining -= take;
      rest -= take;
    }
    // rest > 0(부여보다 차감이 많음)은 ADJUST(-) 과차감 케이스 — balance가 음수로 드러나므로 여기선 무시.
  }
  const balance = entries.reduce((t, e) => t + e.days, 0);
  return { balance: round2(balance), grants };
}

/** asOf(포함) 기준 소멸 대상: expiresAt <= asOf 인 부여분의 미소진 잔량. cron이 EXPIRE 행(-잔량)을 만들 근거. */
export function expiryCandidates(entries: LedgerEntry[], asOfISO: string): { grantId: string; expireDays: number; expiresAt: string }[] {
  const { grants } = computeLedgerState(entries);
  return grants
    .filter((g) => g.expiresAt != null && g.expiresAt <= asOfISO && g.remaining > 0)
    .map((g) => ({ grantId: g.id, expireDays: round2(g.remaining), expiresAt: g.expiresAt! }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
