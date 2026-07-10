import { describe, it, expect } from "vitest";
import { computeAbsentDates } from "@/lib/attendance/absentDays";

// 테스트 그물: 결근 합성 공유 엔진. #14 회귀(면제 배정 오늘 오결근)를 고정한다.
// 2026-07엔 국가 공휴일이 없어 평일=소정근로일. today=2026-07-15(수), 어제=07-14(화) 둘 다 평일.
const base = {
  from: "2026-07-01",
  to: "2026-07-31",
  assignStart: "2026-07-01",
  assignEnd: null as string | null,
  todayStr: "2026-07-15",
  existingDates: new Set<string>(),
};

describe("computeAbsentDates — 면제 배정 오늘 제외(#14 회귀 고정)", () => {
  it("일반 배정: 오늘(07-15)도 결근 판정에 포함", () => {
    const absents = computeAbsentDates({ ...base });
    expect(absents).toContain("2026-07-15");
  });
  it("면제 배정: 오늘(07-15) 제외, 어제(07-14)까지만", () => {
    const absents = computeAbsentDates({ ...base, exemptToday: true });
    expect(absents).not.toContain("2026-07-15");
    expect(absents).toContain("2026-07-14");
  });
  it("면제 배정이라도 미래일은 원래부터 제외", () => {
    const absents = computeAbsentDates({ ...base, exemptToday: true });
    expect(absents).not.toContain("2026-07-16");
  });
  it("출근기록 있는 날은 결근 아님(exempt 무관)", () => {
    const absents = computeAbsentDates({ ...base, existingDates: new Set(["2026-07-13"]) });
    expect(absents).not.toContain("2026-07-13");
  });
});
