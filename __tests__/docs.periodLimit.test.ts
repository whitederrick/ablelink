import { describe, it, expect } from "vitest";
import { checkDocPeriod, MAX_DOC_PERIOD_DAYS } from "@/lib/docs/periodLimit";

describe("checkDocPeriod — 문서 기간 검증(2026-10-08 감사 P2)", () => {
  it("정상 기간(한 달·하루·윤년 포함)은 통과", () => {
    expect(checkDocPeriod("2026-10-01", "2026-10-31")).toBeNull();
    expect(checkDocPeriod("2026-10-05", "2026-10-05")).toBeNull();
    expect(checkDocPeriod("2024-02-01", "2024-02-29")).toBeNull();
  });

  it("종합평가용 장기 기간도 상한 안이면 통과(6개월, 경계 400일)", () => {
    expect(checkDocPeriod("2026-01-01", "2026-06-30")).toBeNull();
    expect(checkDocPeriod("2026-01-01", "2027-02-04")).toBeNull(); // 400일 정확히
  });

  it("상한 초과(401일)는 거절", () => {
    expect(MAX_DOC_PERIOD_DAYS).toBe(400);
    expect(checkDocPeriod("2026-01-01", "2027-02-05")).toContain("최대 400일");
  });

  it("★감사 재현: 0001-01-01~9999-12-31(약 52만 주 루프) 거절", () => {
    expect(checkDocPeriod("0001-01-01", "9999-12-31")).toContain("최대");
  });

  it("시작일이 종료일보다 늦으면 거절", () => {
    expect(checkDocPeriod("2026-10-31", "2026-10-01")).toContain("늦습니다");
  });
});
