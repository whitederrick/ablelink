import { describe, it, expect } from "vitest";
import {
  checkSupervisionInvariants,
  firstSupervisionMessage,
  type PlacementRef,
  type AssignmentRef,
  type SupervisionRef,
} from "@/lib/trainee/supervision";

// 직무지도원 전담(TraineeSupervision) 관계 불변식 — D-1 §3
//  3-1 훈련생 일치 · 3-2 현장 일치 · 3-3 기간 포함(⊆재적, ⊆배정) · 3-4 동일 훈련생 담당 중복 금지

const T1 = BigInt(1), T2 = BigInt(2);

const placement: PlacementRef = {
  id: BigInt(10), traineeId: T1, siteId: BigInt(100),
  startDate: "2026-08-01", endDate: "2026-08-31",
};

const assignment: AssignmentRef = {
  id: BigInt(20), siteId: BigInt(100), status: "ACTIVE",
  startDate: "2026-08-01", endDate: "2026-08-31",
};

const base = {
  traineeId: T1, placementId: BigInt(10), assignmentId: BigInt(20),
  startDate: "2026-08-05", endDate: "2026-08-20",
};

describe("담당 관계 불변식 — 정상 케이스", () => {
  it("재적·배정 기간 안의 담당은 통과", () => {
    const r = checkSupervisionInvariants(base, placement, assignment, []);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("기간이 재적·배정과 정확히 일치해도 통과(경계 포함)", () => {
    const r = checkSupervisionInvariants(
      { ...base, startDate: "2026-08-01", endDate: "2026-08-31" },
      placement, assignment, [],
    );
    expect(r.ok).toBe(true);
  });

  it("★한 직무지도원이 다른 훈련생을 동시 담당하는 것은 정상(1:多의 근거)", () => {
    // 같은 배정(=같은 직무지도원)에 훈련생 T1·T2를 같은 기간 담당.
    // existing은 '같은 훈련생'만 전달되므로 T2 후보에 대해 T1의 기존 관계는 대상이 아니다.
    const otherTrainee: PlacementRef = { ...placement, id: BigInt(11), traineeId: T2 };
    const r = checkSupervisionInvariants(
      { ...base, traineeId: T2, placementId: BigInt(11) },
      otherTrainee, assignment, [],
    );
    expect(r.ok).toBe(true);
  });

  it("열린 담당 기간(endDate=null)은 열린 재적·배정 안에서 통과", () => {
    const openPlacement: PlacementRef = { ...placement, endDate: null };
    const openAssignment: AssignmentRef = { ...assignment, endDate: null };
    const r = checkSupervisionInvariants(
      { ...base, endDate: null }, openPlacement, openAssignment, [],
    );
    expect(r.ok).toBe(true);
  });
});

describe("3-1 훈련생 일치", () => {
  it("재적의 훈련생과 다르면 거부", () => {
    const r = checkSupervisionInvariants({ ...base, traineeId: T2 }, placement, assignment, []);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("TRAINEE_MISMATCH");
  });
});

describe("3-2 현장 일치", () => {
  it("배정 현장과 재적 현장이 다르면 거부", () => {
    const otherSite: AssignmentRef = { ...assignment, siteId: BigInt(999) };
    const r = checkSupervisionInvariants(base, placement, otherSite, []);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("SITE_MISMATCH");
  });
});

describe("3-3 기간 포함", () => {
  it("재적 시작 전에 시작하면 거부", () => {
    const r = checkSupervisionInvariants(
      { ...base, startDate: "2026-07-25" }, placement, assignment, [],
    );
    expect(r.violations).toContain("OUTSIDE_PLACEMENT");
  });

  it("재적 종료 후까지 이어지면 거부", () => {
    const r = checkSupervisionInvariants(
      { ...base, endDate: "2026-09-10" }, placement, assignment, [],
    );
    expect(r.violations).toContain("OUTSIDE_PLACEMENT");
  });

  it("배정보다 넓으면 거부", () => {
    const narrowAssignment: AssignmentRef = {
      ...assignment, startDate: "2026-08-10", endDate: "2026-08-15",
    };
    const r = checkSupervisionInvariants(base, placement, narrowAssignment, []);
    expect(r.violations).toContain("OUTSIDE_ASSIGNMENT");
  });

  it("담당 기간이 열려 있는데 재적은 닫혀 있으면 거부(무기한이 재적을 넘음)", () => {
    const r = checkSupervisionInvariants(
      { ...base, endDate: null }, placement, assignment, [],
    );
    expect(r.violations).toContain("OUTSIDE_PLACEMENT");
  });

  it("★ENDED인데 종료일 없는 배정은 fail-closed", () => {
    const endedOpen: AssignmentRef = { ...assignment, status: "ENDED", endDate: null };
    const r = checkSupervisionInvariants(base, placement, endedOpen, []);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("ASSIGNMENT_ENDED_OPEN");
  });

  it("ENDED라도 종료일이 있으면 기간 포함으로 정상 판정", () => {
    const endedClosed: AssignmentRef = { ...assignment, status: "ENDED" };
    const r = checkSupervisionInvariants(base, placement, endedClosed, []);
    expect(r.ok).toBe(true);
  });

  it("시작일이 종료일보다 늦으면 거부", () => {
    const r = checkSupervisionInvariants(
      { ...base, startDate: "2026-08-20", endDate: "2026-08-05" }, placement, assignment, [],
    );
    expect(r.violations).toContain("INVALID_RANGE");
  });
});

describe("3-4 동일 훈련생 담당 중복 금지", () => {
  const existing: SupervisionRef[] = [
    { id: BigInt(50), traineeId: T1, startDate: "2026-08-01", endDate: "2026-08-10" },
  ];

  it("기간이 겹치면 거부하고 충돌 상대를 반환", () => {
    const r = checkSupervisionInvariants(base, placement, assignment, existing);
    expect(r.ok).toBe(false);
    expect(r.violations).toContain("OVERLAPPING_SUPERVISION");
    expect(r.conflict?.id).toBe(BigInt(50));
  });

  it("경계일 하루만 겹쳐도 거부(8/10 종료 ↔ 8/10 시작)", () => {
    const r = checkSupervisionInvariants(
      { ...base, startDate: "2026-08-10" }, placement, assignment, existing,
    );
    expect(r.violations).toContain("OVERLAPPING_SUPERVISION");
  });

  it("겹치지 않으면 통과(8/10 종료 → 8/11 시작)", () => {
    const r = checkSupervisionInvariants(
      { ...base, startDate: "2026-08-11" }, placement, assignment, existing,
    );
    expect(r.ok).toBe(true);
  });

  it("기존 관계가 열린 기간이면 이후 모든 기간과 겹침", () => {
    const openExisting: SupervisionRef[] = [
      { id: BigInt(51), traineeId: T1, startDate: "2026-08-01", endDate: null },
    ];
    const r = checkSupervisionInvariants(
      { ...base, startDate: "2026-08-25" }, placement, assignment, openExisting,
    );
    expect(r.violations).toContain("OVERLAPPING_SUPERVISION");
  });

  it("다른 훈련생의 관계가 섞여 들어와도 중복으로 보지 않는다(호출부 실수 방어)", () => {
    const otherTraineeExisting: SupervisionRef[] = [
      { id: BigInt(52), traineeId: T2, startDate: "2026-08-01", endDate: "2026-08-31" },
    ];
    const r = checkSupervisionInvariants(base, placement, assignment, otherTraineeExisting);
    expect(r.ok).toBe(true);
  });
});

describe("firstSupervisionMessage", () => {
  it("위반이 없으면 null", () => {
    const r = checkSupervisionInvariants(base, placement, assignment, []);
    expect(firstSupervisionMessage(r)).toBeNull();
  });

  it("위반이 있으면 사용자 메시지를 반환", () => {
    const r = checkSupervisionInvariants({ ...base, traineeId: T2 }, placement, assignment, []);
    expect(firstSupervisionMessage(r)).toContain("훈련생");
  });
});
