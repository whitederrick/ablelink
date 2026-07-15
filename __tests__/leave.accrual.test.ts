import { describe, it, expect } from "vitest";
import {
  addMonthsClamped, addDaysISO,
  monthlyAccrualPeriods, annualAccrualDays, annualAccrualsUpTo, expiryDateOf,
  judgePerfectAttendance, attendanceRateSatisfied, isLeaveExcluded,
  computeLedgerState, expiryCandidates, type LedgerEntry,
} from "@/lib/leave/accrual";

describe("날짜 헬퍼", () => {
  it("addMonthsClamped 말일 클램프", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2024-01-31", 1)).toBe("2024-02-29"); // 윤년
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsClamped("2026-04-03", 12)).toBe("2027-04-03");
  });
  it("addDaysISO 경계", () => {
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysISO("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("monthlyAccrualPeriods — 1년 미만 월 구간", () => {
  it("입사 4/3 → 1구간 4/3~5/2, 발생일 5/3", () => {
    const ps = monthlyAccrualPeriods("2026-04-03", "2026-07-15");
    expect(ps.length).toBe(3); // 4/3~5/2, 5/3~6/2, 6/3~7/2 완결. 7/3~8/2는 미완
    expect(ps[0]).toMatchObject({ seq: 0, start: "2026-04-03", end: "2026-05-02", accrualDate: "2026-05-03" });
    expect(ps[2]).toMatchObject({ start: "2026-06-03", end: "2026-07-02", accrualDate: "2026-07-03" });
  });
  it("최대 11구간(입사 1년까지)", () => {
    const ps = monthlyAccrualPeriods("2025-01-01", "2027-12-31");
    expect(ps.length).toBe(11);
    expect(ps[10]).toMatchObject({ start: "2025-11-01", end: "2025-11-30", accrualDate: "2025-12-01" });
  });
  it("말일 입사(1/31) 구간 경계", () => {
    const ps = monthlyAccrualPeriods("2026-01-31", "2026-05-15");
    // 1/31~2/27(2/28 클램프-1), 2/28~3/30, 3/31~4/29
    expect(ps[0]).toMatchObject({ start: "2026-01-31", end: "2026-02-27", accrualDate: "2026-02-28" });
    expect(ps[1]).toMatchObject({ start: "2026-02-28", end: "2026-03-30" });
    expect(ps[2]).toMatchObject({ start: "2026-03-31", end: "2026-04-29" });
  });
  it("완결 안 된 구간은 미포함", () => {
    expect(monthlyAccrualPeriods("2026-07-01", "2026-07-15").length).toBe(0);
  });
});

describe("annualAccrualDays — 15일+가산(상한 25)", () => {
  it("1·2주년 15, 3·4주년 16, 5·6주년 17", () => {
    expect(annualAccrualDays(1)).toBe(15);
    expect(annualAccrualDays(2)).toBe(15);
    expect(annualAccrualDays(3)).toBe(16);
    expect(annualAccrualDays(4)).toBe(16);
    expect(annualAccrualDays(5)).toBe(17);
  });
  it("상한 25(21주년 이후)", () => {
    expect(annualAccrualDays(21)).toBe(25);
    expect(annualAccrualDays(40)).toBe(25);
  });
  it("annualAccrualsUpTo — 도래분만", () => {
    const list = annualAccrualsUpTo("2024-04-03", "2026-07-15");
    expect(list.length).toBe(2);
    expect(list[0]).toMatchObject({ anniversaryYears: 1, accrualDate: "2025-04-03", days: 15 });
    expect(list[1]).toMatchObject({ anniversaryYears: 2, accrualDate: "2026-04-03", days: 15 });
  });
});

describe("expiryDateOf — 사용기한", () => {
  it("월개근분 = 입사 1주년", () => {
    expect(expiryDateOf("ACCRUAL_MONTHLY", "2026-04-03", "2026-05-03")).toBe("2027-04-03");
  });
  it("연분 = 발생일 + 1년", () => {
    expect(expiryDateOf("ACCRUAL_ANNUAL", "2024-04-03", "2026-04-03")).toBe("2027-04-03");
  });
});

describe("judgePerfectAttendance — 개근 판정", () => {
  const MWF = new Set([1, 3, 5]); // 월·수·금
  // 2026-06-01(월)~2026-06-14(일): 월수금 = 6/1,3,5,8,10,12 (6일)
  it("전부 출근 = 개근(비연속 근무요일 존중)", () => {
    const r = judgePerfectAttendance({
      periodStart: "2026-06-01", periodEnd: "2026-06-14",
      workingWeekdays: MWF, holidaySet: new Set(),
      attendanceDates: new Set(["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-10", "2026-06-12"]),
    });
    expect(r).toMatchObject({ scheduled: 6, attended: 6, perfect: true });
  });
  it("공휴일은 소정근로일에서 제외(빠져도 개근)", () => {
    const r = judgePerfectAttendance({
      periodStart: "2026-06-01", periodEnd: "2026-06-14",
      workingWeekdays: MWF, holidaySet: new Set(["2026-06-03"]), // 수요일 공휴일
      attendanceDates: new Set(["2026-06-01", "2026-06-05", "2026-06-08", "2026-06-10", "2026-06-12"]),
    });
    expect(r).toMatchObject({ scheduled: 5, perfect: true });
  });
  it("소정근로일 1일 결근 → 개근 실패 + missing 명시", () => {
    const r = judgePerfectAttendance({
      periodStart: "2026-06-01", periodEnd: "2026-06-14",
      workingWeekdays: MWF, holidaySet: new Set(),
      attendanceDates: new Set(["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-10"]),
    });
    expect(r.perfect).toBe(false);
    expect(r.missing).toEqual(["2026-06-12"]);
  });
  it("연차 사용일은 출근으로 간주(개근 유지)", () => {
    const r = judgePerfectAttendance({
      periodStart: "2026-06-01", periodEnd: "2026-06-14",
      workingWeekdays: MWF, holidaySet: new Set(),
      attendanceDates: new Set(["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-10"]),
      leaveDates: new Set(["2026-06-12"]),
    });
    expect(r.perfect).toBe(true);
  });
  it("소정근로일 0 = 발생 없음(perfect=false)", () => {
    const r = judgePerfectAttendance({
      periodStart: "2026-06-06", periodEnd: "2026-06-07", // 토·일만
      workingWeekdays: MWF, holidaySet: new Set(), attendanceDates: new Set(),
    });
    expect(r).toMatchObject({ scheduled: 0, perfect: false });
  });
  it("출근율 80% 판정(1년 트랙)", () => {
    expect(attendanceRateSatisfied({ scheduled: 10, attended: 8 })).toBe(true);
    expect(attendanceRateSatisfied({ scheduled: 10, attended: 7 })).toBe(false);
    expect(attendanceRateSatisfied({ scheduled: 0, attended: 0 })).toBe(false);
  });
});

describe("isLeaveExcluded — 초단시간(주 15h 미만) 제외", () => {
  it("주 5.5h×2일=11h → 제외", () => {
    expect(isLeaveExcluded(330, 2)).toBe(true);
  });
  it("주 4h×5일=20h → 적용", () => {
    expect(isLeaveExcluded(240, 5)).toBe(false);
  });
  it("정확히 15h → 적용(미만만 제외)", () => {
    expect(isLeaveExcluded(180, 5)).toBe(false);
  });
  it("판정 불가(소정시간 없음) → 제외하지 않음(보수적)", () => {
    expect(isLeaveExcluded(null, 5)).toBe(false);
  });
});

describe("computeLedgerState / expiryCandidates — FIFO 원장", () => {
  const E = (id: string, kind: LedgerEntry["kind"], days: number, effectiveDate: string, expiresAt: string | null = null): LedgerEntry =>
    ({ id, kind, days, effectiveDate, expiresAt });

  it("잔여 = 부호합, 차감은 오래된 부여부터 소진", () => {
    const st = computeLedgerState([
      E("1", "ACCRUAL_MONTHLY", 1, "2026-05-03", "2027-04-03"),
      E("2", "ACCRUAL_MONTHLY", 1, "2026-06-03", "2027-04-03"),
      E("3", "USE", -1, "2026-06-20"),
    ]);
    expect(st.balance).toBe(1);
    expect(st.grants[0]).toMatchObject({ id: "1", remaining: 0 });
    expect(st.grants[1]).toMatchObject({ id: "2", remaining: 1 });
  });
  it("소멸 후보 = 기한 지난 부여분의 미소진 잔량만", () => {
    const entries = [
      E("1", "ACCRUAL_MONTHLY", 1, "2026-05-03", "2027-04-03"),
      E("2", "ACCRUAL_ANNUAL", 15, "2027-04-03", "2028-04-03"),
      E("3", "USE", -0.5, "2026-07-01"),
    ];
    const cands = expiryCandidates(entries, "2027-04-03");
    expect(cands.length).toBe(1);
    expect(cands[0]).toMatchObject({ grantId: "1", expireDays: 0.5 });
  });
  it("EXPIRE 기록 후에는 소멸 후보 없음(멱등)", () => {
    const entries = [
      E("1", "ACCRUAL_MONTHLY", 1, "2026-05-03", "2027-04-03"),
      E("2", "EXPIRE", -1, "2027-04-03"),
    ];
    expect(expiryCandidates(entries, "2027-04-10").length).toBe(0);
    expect(computeLedgerState(entries).balance).toBe(0);
  });
  it("ADJUST(-) 과차감이면 잔여 음수로 드러남", () => {
    const st = computeLedgerState([
      E("1", "ACCRUAL_MONTHLY", 1, "2026-05-03", "2027-04-03"),
      E("2", "ADJUST", -2, "2026-06-01"),
    ]);
    expect(st.balance).toBe(-1);
  });
  it("소수 일수(0.5) 라운딩 안전", () => {
    const st = computeLedgerState([
      E("1", "ADJUST", 0.5, "2026-05-01"),
      E("2", "ADJUST", 0.25, "2026-05-02"),
      E("3", "USE", -0.5, "2026-05-03"),
    ]);
    expect(st.balance).toBe(0.25);
  });
});
