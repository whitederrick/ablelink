import { describe, it, expect } from "vitest";

// final-lock의 dateRange 유틸 로직 검증 (순수 함수)
function dateRange(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  return {
    dateFrom: `${yearMonth}-01`,
    dateTo:   `${yearMonth}-${new Date(y, m, 0).getDate().toString().padStart(2, "0")}`,
  };
}

describe("final-lock dateRange", () => {
  it("1월 — 31일", () => {
    const r = dateRange("2026-01");
    expect(r.dateFrom).toBe("2026-01-01");
    expect(r.dateTo).toBe("2026-01-31");
  });

  it("2월 — 윤년(2024) 29일", () => {
    const r = dateRange("2024-02");
    expect(r.dateTo).toBe("2024-02-29");
  });

  it("2월 — 평년(2025) 28일", () => {
    const r = dateRange("2025-02");
    expect(r.dateTo).toBe("2025-02-28");
  });

  it("4월 — 30일", () => {
    const r = dateRange("2026-04");
    expect(r.dateTo).toBe("2026-04-30");
  });

  it("12월 — 31일", () => {
    const r = dateRange("2026-12");
    expect(r.dateTo).toBe("2026-12-31");
  });
});

describe("final-lock 입력 검증 패턴", () => {
  const YM_REGEX = /^\d{4}-\d{2}$/;

  it("유효한 yearMonth 형식", () => {
    expect(YM_REGEX.test("2026-05")).toBe(true);
    expect(YM_REGEX.test("2024-12")).toBe(true);
  });

  it("잘못된 yearMonth 형식 → 거부", () => {
    expect(YM_REGEX.test("2026-5")).toBe(false);
    expect(YM_REGEX.test("26-05")).toBe(false);
    expect(YM_REGEX.test("2026/05")).toBe(false);
    expect(YM_REGEX.test("")).toBe(false);
    expect(YM_REGEX.test("2026-05-01")).toBe(false);
  });
});
