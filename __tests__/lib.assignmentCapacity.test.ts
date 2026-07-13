import { describe, it, expect } from "vitest";
import { findCapacityOverflow } from "@/lib/assignmentCapacity";

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 그물: 슬롯별 정원 검사(#7). 과거 총합 검사가 슬롯 분포를 무시하던 것을 종결.
// ─────────────────────────────────────────────────────────────────────────────
const cap = (am: number, pm: number, full: number, custom: number) => ({ AM: am, PM: pm, FULL_DAY: full, CUSTOM: custom });

describe("findCapacityOverflow — 슬롯별 정원(#7)", () => {
  it("★#7 버그: 오전정원 2·오후정원 0인데 오후 2명 선정 → 초과(과거엔 총합2로 통과)", () => {
    const o = findCapacityOverflow(cap(2, 0, 0, 0), {}, { PM: 2 });
    expect(o).toEqual({ slot: "PM", sel: 2, remaining: 0 });
  });

  it("슬롯 내 선정은 통과: 오전정원 2·오전 2명", () => {
    expect(findCapacityOverflow(cap(2, 0, 0, 0), {}, { AM: 2 })).toBeNull();
  });

  it("정원 아예 미설정(전부 0) → 무제한(하위호환): 오전 5명도 통과", () => {
    expect(findCapacityOverflow(cap(0, 0, 0, 0), {}, { AM: 5 })).toBeNull();
  });

  it("CUSTOM은 customCapacity 없으면 거부: 오전정원만 있고 맞춤 1명 선정 → 초과", () => {
    const o = findCapacityOverflow(cap(1, 0, 0, 0), {}, { CUSTOM: 1 });
    expect(o).toEqual({ slot: "CUSTOM", sel: 1, remaining: 0 });
  });

  it("customCapacity 설정 시 맞춤 통과: 맞춤정원 2·맞춤 2명", () => {
    expect(findCapacityOverflow(cap(0, 0, 0, 2), {}, { CUSTOM: 2 })).toBeNull();
  });

  it("이미 채워진 인원 반영: 오전정원 2·기존 1명·오전 2명 선정 → 초과(남은 1)", () => {
    const o = findCapacityOverflow(cap(2, 0, 0, 0), { AM: 1 }, { AM: 2 });
    expect(o).toEqual({ slot: "AM", sel: 2, remaining: 1 });
  });

  it("이미 채워진 인원 반영: 오전정원 2·기존 1명·오전 1명 선정 → 통과", () => {
    expect(findCapacityOverflow(cap(2, 0, 0, 0), { AM: 1 }, { AM: 1 })).toBeNull();
  });

  it("여러 슬롯 동시: 오전2·오후1 정원, 오전2·오후1 선정 → 통과", () => {
    expect(findCapacityOverflow(cap(2, 1, 0, 0), {}, { AM: 2, PM: 1 })).toBeNull();
  });

  it("여러 슬롯 중 하나만 초과: 오전2·오후1 정원, 오전1·오후2 선정 → 오후 초과", () => {
    const o = findCapacityOverflow(cap(2, 1, 0, 0), {}, { AM: 1, PM: 2 });
    expect(o).toEqual({ slot: "PM", sel: 2, remaining: 1 });
  });
});
