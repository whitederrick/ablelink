// 일지 숫자·짧은 텍스트 입력 검증 (2026-10-08 감사 P3)
import { describe, it, expect } from "vitest";
import { checkLogHours, checkShortText, MAX_LOG_HOURS } from "@/lib/docs/logTextLimit";

describe("checkLogHours", () => {
  it("미입력·정상 범위는 통과", () => {
    expect(checkLogHours("지도시간", undefined)).toBeNull();
    expect(checkLogHours("지도시간", null)).toBeNull();
    expect(checkLogHours("지도시간", "")).toBeNull();
    expect(checkLogHours("지도시간", 0)).toBeNull();
    expect(checkLogHours("지도시간", 4.5)).toBeNull();
    expect(checkLogHours("지도시간", "8")).toBeNull();
    expect(checkLogHours("지도시간", MAX_LOG_HOURS)).toBeNull();
  });

  it.each([-1, 24.01, 9999, Number.NaN, Infinity, "abc", "1e9", {}, [], true])("비정상 값은 거부: %s", (v) => {
    expect(checkLogHours("지도시간", v)).toContain("지도시간");
  });
});

describe("checkShortText", () => {
  it("상한 이내는 통과, 초과는 거부, 비문자열은 통과(별도 처리)", () => {
    expect(checkShortText("과제명", "a".repeat(100), 100)).toBeNull();
    expect(checkShortText("과제명", "a".repeat(101), 100)).toContain("100자");
    expect(checkShortText("과제명", undefined, 100)).toBeNull();
  });
});
