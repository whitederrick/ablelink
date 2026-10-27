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

import { checkRequestedWrittenDate } from "@/lib/pdf/writtenDate";

describe("checkRequestedWrittenDate — 사용자 지정 작성일", () => {
  const TODAY = "2026-10-05";
  it("비어 있으면 지정 없음(null) — 종전처럼 문서를 만든 날", () => {
    for (const v of [undefined, null, ""]) expect(checkRequestedWrittenDate(v, "2026-10-31", TODAY)).toEqual({ value: null, error: null });
  });
  it("기간 종료일(말일)까지는 오늘보다 미래여도 허용", () => {
    expect(checkRequestedWrittenDate("2026-10-31", "2026-10-31", TODAY)).toEqual({ value: "2026-10-31", error: null });
  });
  it("종료일 다음 날(미래)은 거절", () => {
    expect(checkRequestedWrittenDate("2026-11-01", "2026-10-31", TODAY).error).toBeTruthy();
  });
  it("지난 기간을 뒤늦게 만들 때는 오늘까지 허용(종료일 이후여도)", () => {
    expect(checkRequestedWrittenDate("2026-10-05", "2026-09-30", TODAY)).toEqual({ value: "2026-10-05", error: null });
    expect(checkRequestedWrittenDate("2026-10-06", "2026-09-30", TODAY).error).toBeTruthy();
  });
  it("형식·실존이 아니면 거절", () => {
    for (const bad of ["2026-02-30", "20261031", "abc", 20261031, {}]) expect(checkRequestedWrittenDate(bad, "2026-10-31", TODAY).error).toBeTruthy();
  });
});
