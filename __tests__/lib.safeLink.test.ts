// 공지 이동 링크: 앱 내부 경로만 허용 (2026-10-08 감사 P3)
import { describe, it, expect } from "vitest";
import { internalLinkOrNull } from "@/lib/safeLink";

describe("internalLinkOrNull", () => {
  it("앱 내부 경로는 통과한다", () => {
    expect(internalLinkOrNull("/worker/home")).toBe("/worker/home");
    expect(internalLinkOrNull("/worker/payroll?ym=2026-11#top")).toBe("/worker/payroll?ym=2026-11#top");
    expect(internalLinkOrNull("  /worker/calendar  ")).toBe("/worker/calendar");
  });

  it.each([
    "https://evil.example/login",
    "http://evil.example",
    "//evil.example/login",
    "/\\evil.example",
    "javascript:alert(1)",
    "evil.example/path",
    "worker/home",
    "/worker/home\n//evil.example",
    "/worker\t/home",
  ])("외부·우회 형태는 거부한다: %s", (v) => {
    expect(internalLinkOrNull(v)).toBeNull();
  });

  it("빈 값·비문자열·너무 긴 값은 null", () => {
    expect(internalLinkOrNull("")).toBeNull();
    expect(internalLinkOrNull(undefined)).toBeNull();
    expect(internalLinkOrNull(123)).toBeNull();
    expect(internalLinkOrNull("/" + "a".repeat(300))).toBeNull();
  });
});
