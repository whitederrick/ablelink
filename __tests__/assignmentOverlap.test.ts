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

// W#6: PATCH 배정 편집 시 '새로 생기는' 충돌만 차단(기존부터 겹치던 레거시는 grandfather).
//  라우트 결정: others.find(o => conflict(candidate,o) && !conflict(preEdit,o))
const newConflict = (candidate: any, preEdit: any, others: any[]) =>
  others.find(o => assignmentsTimeConflict(candidate, o) && !assignmentsTimeConflict(preEdit, o)) ?? null;

describe("W#6 — 새 충돌만 차단(레거시 grandfather)", () => {
  const other = { id: 9, ...range, workType: "FULL_DAY" }; // 다른 현장 종일(레거시 겹침 상대)

  it("무관 필드 편집(스케줄 불변) — 레거시 겹침 있어도 허용", () => {
    // 이미 FULL_DAY로 other와 겹치는 배정. serviceStep만 바꿈 → candidate==preEdit.
    const preEdit = { ...range, workType: "FULL_DAY" };
    const candidate = { ...range, workType: "FULL_DAY" }; // 스케줄 동일
    expect(newConflict(candidate, preEdit, [other])).toBeNull(); // 차단 안 함
  });

  it("새 충돌 도입(AM→FULL_DAY, 상대 PM) — 차단", () => {
    const pm = { id: 8, ...range, workType: "PM" };
    const preEdit = { ...range, workType: "AM" };     // AM+PM=겹침없음
    const candidate = { ...range, workType: "FULL_DAY" }; // FULL_DAY+PM=겹침(새로)
    expect(newConflict(candidate, preEdit, [pm])?.id).toBe(8); // 차단
  });

  it("레거시 충돌 완화(FULL_DAY→AM, 상대 FULL_DAY) — 여전히 겹쳐도 허용", () => {
    const preEdit = { ...range, workType: "FULL_DAY" }; // 이미 겹침
    const candidate = { ...range, workType: "AM" };      // AM+FULL_DAY=여전히 겹침이나 '새'는 아님
    expect(newConflict(candidate, preEdit, [other])).toBeNull(); // 허용(개선 방향)
  });

  it("기간 확장으로 다른 상대와 새로 겹침 — 차단", () => {
    const late = { id: 7, startDate: "2026-08-01", endDate: "2026-08-31", workType: "AM" };
    const preEdit = { startDate: "2026-07-01", endDate: "2026-07-31", workType: "AM" }; // 7월만, late와 안 겹침
    const candidate = { startDate: "2026-07-01", endDate: "2026-08-31", workType: "AM" }; // 8월까지 확장 → late와 겹침
    expect(newConflict(candidate, preEdit, [late])?.id).toBe(7); // 차단
  });
});
