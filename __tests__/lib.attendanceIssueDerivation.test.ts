import { describe, it, expect } from "vitest";
import { deriveAttendanceIssues, type AttendanceIssueRow } from "@/lib/attendance/issueDerivation";
import { kstWallTimeToInstant } from "@/lib/workSchedule";

const TODAY = "2026-06-08";

// 기본: 정상 기록(FULL_DAY 표준 09:00 정시 출근, 거리 OK, 과거 완료일)
function base(over: Partial<AttendanceIssueRow> = {}): AttendanceIssueRow {
  return {
    startTime: kstWallTimeToInstant(TODAY, "09:00"),
    endTime: kstWallTimeToInstant(TODAY, "18:00"),
    actualStartTime: kstWallTimeToInstant(TODAY, "09:00"),
    actualEndTime: kstWallTimeToInstant(TODAY, "18:00"),
    startDistanceM: 10,
    rangeM: 100,
    workType: "FULL_DAY",
    commuteGuidanceIncluded: false,
    customWorkStart: null,
    customWorkEnd: null,
    status: "DONE",
    workDate: "2026-06-01", // 과거
    ...over,
  };
}
const OPTS = { lateThresholdMin: 15, todayStr: TODAY };

describe("deriveAttendanceIssues — 대시보드·인박스 공용 근태 이슈 도출", () => {
  it("정상 기록 → 이슈 없음", () => {
    expect(deriveAttendanceIssues(base(), OPTS)).toEqual([]);
  });

  it("출근시각 없음 → MISSING_CLOCK_IN", () => {
    expect(deriveAttendanceIssues(base({ startTime: null }), OPTS)).toContain("MISSING_CLOCK_IN");
  });

  it("퇴근시각 없음(과거일) → MISSING_CLOCK_OUT", () => {
    expect(deriveAttendanceIssues(base({ endTime: null }), OPTS)).toContain("MISSING_CLOCK_OUT");
  });

  it("오늘+WORKING(근무 진행중) 퇴근없음 → MISSING_CLOCK_OUT 아님(오탐 제외)", () => {
    const r = deriveAttendanceIssues(base({ endTime: null, workDate: TODAY, status: "WORKING" }), OPTS);
    expect(r).not.toContain("MISSING_CLOCK_OUT");
  });

  it("출근 거리 > 허용 반경 → OUT_OF_RANGE", () => {
    expect(deriveAttendanceIssues(base({ startDistanceM: 150, rangeM: 100 }), OPTS)).toContain("OUT_OF_RANGE");
  });

  it("실제 출근이 임계(15분) 이상 지각 → TIME_ANOMALY", () => {
    // FULL_DAY 표준 출근 09:00, 실제 09:20 = 20분 지각
    const r = deriveAttendanceIssues(base({ actualStartTime: kstWallTimeToInstant(TODAY, "09:20") }), OPTS);
    expect(r).toContain("TIME_ANOMALY");
  });

  it("임계 미만 지각(10분) → TIME_ANOMALY 아님", () => {
    const r = deriveAttendanceIssues(base({ actualStartTime: kstWallTimeToInstant(TODAY, "09:10") }), OPTS);
    expect(r).not.toContain("TIME_ANOMALY");
  });

  it("실제 출근시각 없음(과거·일괄생성) → 지각 판정 안 함", () => {
    const r = deriveAttendanceIssues(base({ actualStartTime: null }), OPTS);
    expect(r).not.toContain("TIME_ANOMALY");
  });

  // ── 출퇴근 시간 이상(TIME_OUTLIER): 지각과 별개 ──
  it("시각 역전(퇴근 ≤ 출근) → TIME_OUTLIER", () => {
    // 출근 09:00, 퇴근 08:30 (퇴근이 출근보다 이름) — 지각/이른출근 아님
    const r = deriveAttendanceIssues(base({ actualEndTime: kstWallTimeToInstant(TODAY, "08:30") }), OPTS);
    expect(r).toContain("TIME_OUTLIER");
    expect(r).not.toContain("TIME_ANOMALY");
  });

  it("표준보다 60분+ 이른 출근 → TIME_OUTLIER (지각 아님)", () => {
    // FULL_DAY 표준 09:00, 실제 07:30 (90분 이름)
    const r = deriveAttendanceIssues(base({ actualStartTime: kstWallTimeToInstant(TODAY, "07:30") }), OPTS);
    expect(r).toContain("TIME_OUTLIER");
    expect(r).not.toContain("TIME_ANOMALY");
  });

  it("표준보다 60분+ 늦은 퇴근 → TIME_OUTLIER", () => {
    // FULL_DAY 표준 퇴근 18:00, 실제 19:30 (90분 늦음)
    const r = deriveAttendanceIssues(base({ actualEndTime: kstWallTimeToInstant(TODAY, "19:30") }), OPTS);
    expect(r).toContain("TIME_OUTLIER");
  });

  it("정상 출퇴근(09:00~18:00) → TIME_OUTLIER 아님", () => {
    expect(deriveAttendanceIssues(base(), OPTS)).not.toContain("TIME_OUTLIER");
  });
});
