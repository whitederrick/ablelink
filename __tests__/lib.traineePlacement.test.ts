import { describe, it, expect } from "vitest";
import { traineeCountOnDate, isMultiTraineeOnDate, type PlacementSpan } from "@/lib/traineePlacement";

const d = (s: string) => new Date(s + "T00:00:00+09:00");

describe("traineeCountOnDate / isMultiTraineeOnDate — 1:多 단일 규칙", () => {
  const placements: PlacementSpan[] = [
    { siteId: BigInt(1), startDate: d("2026-06-01"), endDate: null },              // site1 상시
    { siteId: BigInt(1), startDate: d("2026-06-10"), endDate: d("2026-06-20") },  // site1 기간
    { siteId: BigInt(2), startDate: d("2026-06-01"), endDate: null },              // site2
  ];

  it("날짜별 동시 재적 수(siteId 지정)", () => {
    expect(traineeCountOnDate(placements, "2026-06-05", BigInt(1))).toBe(1); // 두번째 아직 시작 전
    expect(traineeCountOnDate(placements, "2026-06-15", BigInt(1))).toBe(2); // 겹침 → 2
    expect(traineeCountOnDate(placements, "2026-06-25", BigInt(1))).toBe(1); // 두번째 종료 후
    expect(traineeCountOnDate(placements, "2026-06-15", BigInt(2))).toBe(1);
  });

  it("경계 포함(endDate 당일 재적)", () => {
    expect(traineeCountOnDate(placements, "2026-06-20", BigInt(1))).toBe(2); // endDate 당일 포함
    expect(traineeCountOnDate(placements, "2026-06-21", BigInt(1))).toBe(1);
  });

  it("isMulti = 2명 이상", () => {
    expect(isMultiTraineeOnDate(placements, "2026-06-15", BigInt(1))).toBe(true);
    expect(isMultiTraineeOnDate(placements, "2026-06-05", BigInt(1))).toBe(false);
  });

  it("siteId 미지정 시 전체 집계(출근부: 단일현장 사전필터 케이스)", () => {
    // site 무관 전체 = 06-15에 site1 2 + site2 1 = 3
    expect(traineeCountOnDate(placements, "2026-06-15")).toBe(3);
  });

  it("siteId=null이면 computeRun 래퍼가 0 처리(여기선 미필터라 전체) — 래퍼 책임 경계 확인", () => {
    // 함수 자체는 siteId==null이면 필터 스킵. computeRun은 호출 전 null 가드(0)로 처리함.
    expect(traineeCountOnDate(placements, "2026-06-15", null)).toBe(3);
  });
});
