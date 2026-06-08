import { describe, it, expect } from "vitest";
import { computeWorkTimes, kstWallTimeToInstant } from "@/lib/workSchedule";

describe("computeWorkTimes — 근무형태별 표준 출퇴근 시각", () => {
  it("오전 4시간(AM) — 출퇴근지도 포함(기본): 08:30~14:00", () => {
    expect(computeWorkTimes("AM", true)).toEqual({ start: "08:30", end: "14:00" });
  });
  it("오전 4시간(AM) — 출퇴근지도 미포함(예외): 09:00~13:30", () => {
    expect(computeWorkTimes("AM", false)).toEqual({ start: "09:00", end: "13:30" });
  });
  it("오후 4시간(PM) — 포함(기본): 12:30~18:00", () => {
    expect(computeWorkTimes("PM", true)).toEqual({ start: "12:30", end: "18:00" });
  });
  it("오후 4시간(PM) — 미포함(예외): 13:00~17:30", () => {
    expect(computeWorkTimes("PM", false)).toEqual({ start: "13:00", end: "17:30" });
  });
  it("전일 8시간(FULL_DAY) — 포함여부 무관 09:00~18:00", () => {
    expect(computeWorkTimes("FULL_DAY", true)).toEqual({ start: "09:00", end: "18:00" });
    expect(computeWorkTimes("FULL_DAY", false)).toEqual({ start: "09:00", end: "18:00" });
  });
  it("CUSTOM — 지정 시각 사용", () => {
    expect(computeWorkTimes("CUSTOM", true, "10:00", "16:00")).toEqual({ start: "10:00", end: "16:00" });
  });
  it("CUSTOM — 미지정 시 전일 기본값", () => {
    expect(computeWorkTimes("CUSTOM", true)).toEqual({ start: "09:00", end: "18:00" });
  });
  it("null/미지정 — 전일 기본값", () => {
    expect(computeWorkTimes(null, true)).toEqual({ start: "09:00", end: "18:00" });
    expect(computeWorkTimes(undefined as any, true)).toEqual({ start: "09:00", end: "18:00" });
  });
});

describe("kstWallTimeToInstant — KST 벽시계 → UTC instant", () => {
  it("08:30 KST → 전날 23:30 UTC", () => {
    expect(kstWallTimeToInstant("2026-06-08", "08:30").toISOString()).toBe("2026-06-07T23:30:00.000Z");
  });
  it("18:00 KST → 09:00 UTC 같은날", () => {
    expect(kstWallTimeToInstant("2026-06-08", "18:00").toISOString()).toBe("2026-06-08T09:00:00.000Z");
  });
  it("09:00 KST → 00:00 UTC 같은날 (자정 경계)", () => {
    expect(kstWallTimeToInstant("2026-06-08", "09:00").toISOString()).toBe("2026-06-08T00:00:00.000Z");
  });
  it("저장된 instant를 KST(UTC+9)로 렌더하면 원래 벽시계로 복원된다", () => {
    const inst = kstWallTimeToInstant("2026-06-08", "08:30");
    const kst = new Date(inst.getTime() + 9 * 60 * 60 * 1000);
    expect(`${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`).toBe("08:30");
  });
});
