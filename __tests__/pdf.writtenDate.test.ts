// 출근부 작성일 — 2026-10-08 감사 P2: 렌더 시각으로 찍혀 재렌더(공단 발송·ZIP)마다 날짜가 바뀌던 문제.
import { describe, it, expect } from "vitest";
import { resolveWrittenDate } from "@/lib/pdf/writtenDate";

const NOW_KST_1020 = new Date("2026-10-20T03:00:00.000Z").getTime(); // 렌더 시각 = 10/20

describe("resolveWrittenDate", () => {
  it("제출 시점 날짜(writtenYMD)가 있으면 렌더 시각과 무관하게 그 날짜", () => {
    expect(resolveWrittenDate("2026-10-05", NOW_KST_1020)).toEqual({ y: 2026, m: 10, d: 5 });
  });

  it("writtenYMD가 없는 이전 스냅샷은 렌더 시각(KST)으로 폴백", () => {
    expect(resolveWrittenDate(undefined, NOW_KST_1020)).toEqual({ y: 2026, m: 10, d: 20 });
    expect(resolveWrittenDate(null, NOW_KST_1020)).toEqual({ y: 2026, m: 10, d: 20 });
  });

  it("폴백은 UTC가 아니라 KST 벽시계일 — UTC 15:30은 이미 KST 다음 날", () => {
    expect(resolveWrittenDate(undefined, new Date("2026-10-08T15:30:00.000Z").getTime())).toEqual({ y: 2026, m: 10, d: 9 });
  });

  it("형식·실존이 아닌 값은 무시하고 폴백(문서에 쓰레기 날짜가 찍히지 않게)", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "20261005", "abc", "", 20261005, {}]) {
      expect(resolveWrittenDate(bad, NOW_KST_1020)).toEqual({ y: 2026, m: 10, d: 20 });
    }
  });
});
