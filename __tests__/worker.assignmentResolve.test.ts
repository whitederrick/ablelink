import { describe, it, expect } from "vitest";
import {
  isTodayActive,
  latestTodayActive,
  resolveWorkerAssignment,
  type AssignmentLite,
} from "@/lib/worker/assignmentResolve";

const TODAY = "2026-07-10";

// 헬퍼: 배정 하나 만들기
function a(
  id: string,
  status: string,
  startDate: string,
  endDate: string | null,
): AssignmentLite {
  return { id, status, startDate, endDate };
}

describe("isTodayActive", () => {
  it("ACTIVE + 오늘이 기간 안 = true", () => {
    expect(isTodayActive(a("1", "ACTIVE", "2026-07-01", "2026-07-31"), TODAY)).toBe(true);
  });
  it("endDate=null(무기한) 열린 배정도 오늘 활성", () => {
    expect(isTodayActive(a("1", "ACTIVE", "2026-07-01", null), TODAY)).toBe(true);
  });
  it("오늘 시작하는 배정도 활성(경계 포함)", () => {
    expect(isTodayActive(a("1", "ACTIVE", TODAY, TODAY), TODAY)).toBe(true);
  });
  it("ENDED는 기간이 오늘을 덮어도 비활성", () => {
    expect(isTodayActive(a("1", "ENDED", "2026-07-01", "2026-07-31"), TODAY)).toBe(false);
  });
  it("기간이 지난(endDate<오늘) ACTIVE도 비활성", () => {
    expect(isTodayActive(a("1", "ACTIVE", "2026-06-01", "2026-06-30"), TODAY)).toBe(false);
  });
  it("아직 시작 안 한(start>오늘) 배정은 비활성", () => {
    expect(isTodayActive(a("1", "ACTIVE", "2026-07-20", "2026-07-31"), TODAY)).toBe(false);
  });
  it("ASSIGNED/CONFIRMED는 오늘 활성 아님", () => {
    expect(isTodayActive(a("1", "ASSIGNED", "2026-07-01", "2026-07-31"), TODAY)).toBe(false);
    expect(isTodayActive(a("1", "CONFIRMED", "2026-07-01", "2026-07-31"), TODAY)).toBe(false);
  });
});

describe("latestTodayActive", () => {
  it("오늘 활성 여러 개면 startDate 최신 1건", () => {
    const list = [
      a("1", "ACTIVE", "2026-07-01", "2026-07-31"),
      a("2", "ACTIVE", "2026-07-05", "2026-07-31"),
    ];
    expect(latestTodayActive(list, TODAY)?.id).toBe("2");
  });
  it("활성 없으면 null", () => {
    const list = [a("1", "ENDED", "2026-07-01", "2026-07-09")];
    expect(latestTodayActive(list, TODAY)).toBeNull();
  });
  it("비활성 섞여 있어도 활성 중 최신만", () => {
    const list = [
      a("1", "ENDED", "2026-07-08", "2026-07-09"),
      a("2", "ACTIVE", "2026-07-02", null),
    ];
    expect(latestTodayActive(list, TODAY)?.id).toBe("2");
  });
});

describe("resolveWorkerAssignment — 일지 컨텍스트(allowEnded=false)", () => {
  it("★P1 회귀: ENDED 배정을 가리키는 낡은 쿠키 → 최신 활성으로 폴백(데드엔드 방지)", () => {
    // 워커가 B(쿠키)를 선택했는데 B가 ENDED로 전환되고 A만 활성으로 남음
    const assignments = [
      a("A", "ACTIVE", "2026-07-01", null),
      a("B", "ENDED", "2026-06-01", "2026-07-05"),
    ];
    const r = resolveWorkerAssignment({
      requestedId: "B",
      allowEnded: false,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("A"); // ENDED B가 아니라 활성 A
    expect(r.usedFallback).toBe(true); // 쿠키 되쓰기 신호
    expect(r.reason).toBe("fallback-active");
  });

  it("쿠키가 오늘 활성 배정을 가리키면 그대로 사용", () => {
    const assignments = [
      a("A", "ACTIVE", "2026-07-01", null),
      a("B", "ACTIVE", "2026-07-03", null),
    ];
    const r = resolveWorkerAssignment({
      requestedId: "B",
      allowEnded: false,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("B");
    expect(r.usedFallback).toBe(false);
    expect(r.reason).toBe("explicit-active");
  });

  it("쿠키 없음 + 단일 활성 → 그 활성(단일현장 회귀 없음)", () => {
    const assignments = [a("A", "ACTIVE", "2026-07-01", null)];
    const r = resolveWorkerAssignment({
      requestedId: null,
      allowEnded: false,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("A");
    expect(r.usedFallback).toBe(false);
    expect(r.reason).toBe("fallback-active");
  });

  it("무효 쿠키(목록에 없는 id·재시드로 삭제) → 최신 활성 폴백", () => {
    const assignments = [a("A", "ACTIVE", "2026-07-01", null)];
    const r = resolveWorkerAssignment({
      requestedId: "999",
      allowEnded: false,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("A");
    expect(r.usedFallback).toBe(true);
  });

  it("오늘 활성 배정이 하나도 없으면 null(배정 없음) — ENDED 현장으로 오귀속하지 않음", () => {
    const assignments = [a("B", "ENDED", "2026-06-01", "2026-07-05")];
    const r = resolveWorkerAssignment({
      requestedId: "B",
      allowEnded: false,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBeNull();
    expect(r.reason).toBe("none");
  });

  it("미래 시작 배정을 가리키는 쿠키도 폴백(오늘 못 쓰는 배정 방지)", () => {
    const assignments = [
      a("A", "ACTIVE", "2026-07-01", null),
      a("F", "ACTIVE", "2026-07-20", null),
    ];
    const r = resolveWorkerAssignment({
      requestedId: "F",
      allowEnded: false,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("A");
    expect(r.usedFallback).toBe(true);
  });
});

describe("resolveWorkerAssignment — 과거문서 딥링크(allowEnded=true)", () => {
  it("명시 id가 ENDED여도 그대로 허용(과거 출근부/일지 재제출)", () => {
    const assignments = [
      a("A", "ACTIVE", "2026-07-01", null),
      a("B", "ENDED", "2026-06-01", "2026-06-30"),
    ];
    const r = resolveWorkerAssignment({
      requestedId: "B",
      allowEnded: true,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("B"); // 딥링크는 ENDED 유지
    expect(r.reason).toBe("explicit-ended");
  });

  it("딥링크 id가 무효(목록에 없음)면 최신 활성 폴백", () => {
    const assignments = [a("A", "ACTIVE", "2026-07-01", null)];
    const r = resolveWorkerAssignment({
      requestedId: "999",
      allowEnded: true,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("A");
    expect(r.usedFallback).toBe(true);
  });

  it("딥링크 ASSIGNED/CONFIRMED 배정도 허용(현행 site/current 동작 보존)", () => {
    const assignments = [a("C", "CONFIRMED", "2026-07-20", "2026-08-20")];
    const r = resolveWorkerAssignment({
      requestedId: "C",
      allowEnded: true,
      assignments,
      todayStr: TODAY,
    });
    expect(r.assignmentId).toBe("C");
    expect(r.reason).toBe("explicit-ended");
  });
});
