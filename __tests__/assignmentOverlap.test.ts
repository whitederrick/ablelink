import { describe, it, expect } from "vitest";
import { occupiedHalves, assignmentsTimeConflict, findTimeConflict } from "@/lib/assignmentOverlap";

const range = { startDate: "2026-07-01", endDate: "2026-07-31" };

describe("occupiedHalves", () => {
  it("AM/PM/FULL_DAY 슬롯", () => {
    expect([...occupiedHalves("AM")]).toEqual(["AM"]);
    expect([...occupiedHalves("PM")]).toEqual(["PM"]);
    expect([...occupiedHalves("FULL_DAY")].sort()).toEqual(["AM", "PM"]);
  });
  it("CUSTOM은 13:00 기준 분기", () => {
    expect([...occupiedHalves("CUSTOM", "09:00", "12:00")]).toEqual(["AM"]);
    expect([...occupiedHalves("CUSTOM", "14:00", "17:00")]).toEqual(["PM"]);
    expect([...occupiedHalves("CUSTOM", "10:00", "16:00")].sort()).toEqual(["AM", "PM"]);
  });
  it("CUSTOM 시각 불명확/미지정은 보수적으로 종일", () => {
    expect([...occupiedHalves("CUSTOM", null, null)].sort()).toEqual(["AM", "PM"]);
    expect([...occupiedHalves(null)].sort()).toEqual(["AM", "PM"]);
  });
});

describe("assignmentsTimeConflict", () => {
  it("AM + PM = 겹침 없음(멀티현장 정상 패턴)", () => {
    expect(assignmentsTimeConflict({ ...range, workType: "AM" }, { ...range, workType: "PM" })).toBe(false);
  });
  it("AM + FULL_DAY = 충돌", () => {
    expect(assignmentsTimeConflict({ ...range, workType: "AM" }, { ...range, workType: "FULL_DAY" })).toBe(true);
  });
  it("AM + AM = 충돌", () => {
    expect(assignmentsTimeConflict({ ...range, workType: "AM" }, { ...range, workType: "AM" })).toBe(true);
  });
  it("슬롯 겹쳐도 날짜범위 안 겹치면 충돌 아님", () => {
    expect(assignmentsTimeConflict(
      { startDate: "2026-07-01", endDate: "2026-07-15", workType: "FULL_DAY" },
      { startDate: "2026-07-16", endDate: "2026-07-31", workType: "FULL_DAY" },
    )).toBe(false);
  });
  it("열린 배정(endDate=null)은 이후 기간과 겹침", () => {
    expect(assignmentsTimeConflict(
      { startDate: "2026-07-01", endDate: null, workType: "AM" },
      { startDate: "2026-08-01", endDate: null, workType: "AM" },
    )).toBe(true);
  });
  it("CUSTOM 오전 + PM = 겹침 없음", () => {
    expect(assignmentsTimeConflict(
      { ...range, workType: "CUSTOM", customWorkStart: "09:00", customWorkEnd: "12:00" },
      { ...range, workType: "PM" },
    )).toBe(false);
  });
});

describe("findTimeConflict", () => {
  it("충돌하는 기존 배정을 반환", () => {
    const existing = [
      { id: 1, ...range, workType: "PM" },
      { id: 2, ...range, workType: "FULL_DAY" },
    ];
    const hit = findTimeConflict({ ...range, workType: "AM" }, existing);
    expect(hit?.id).toBe(2); // AM은 PM과 겹치지 않고 FULL_DAY와 겹침
  });
  it("충돌 없으면 null", () => {
    const existing = [{ id: 1, ...range, workType: "PM" }];
    expect(findTimeConflict({ ...range, workType: "AM" }, existing)).toBeNull();
  });
});
