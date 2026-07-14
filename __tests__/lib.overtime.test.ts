import { describe, it, expect } from "vitest";
import {
  computeOvertimeMinutes,
  overtimeMinutesForDay,
  workEndMinutesForDay,
  manualExtHoursFromLogs,
} from "@/lib/attendance/overtime";

// KST 벽시계 시:분 → 저장 instant(UTC). kstMinutes(d) = (utc+9h)의 시:분 이므로 UTC = h-9.
const kst = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 18, h - 9, m));

// ★19차: 면제 1:多 연장 — 그룹 연장(extTimeGroup)은 공유 세션이라 훈련생 N명 일지에 같은 값. 합산하면 N배 과지급.
describe("manualExtHoursFromLogs — 그룹 연장 중복 합산 방지", () => {
  it("1:多 2명, 그룹연장 2h가 각 일지에 → 합산 아닌 2h(max)", () => {
    const logs = [{ extTime1on1: 0, extTimeGroup: 2 }, { extTime1on1: 0, extTimeGroup: 2 }];
    expect(manualExtHoursFromLogs(logs)).toBe(2); // (기존 버그: 4)
  });
  it("1:多 3명, 그룹연장 1.5h → 1.5h", () => {
    const logs = [{ extTime1on1: 0, extTimeGroup: 1.5 }, { extTime1on1: 0, extTimeGroup: 1.5 }, { extTime1on1: 0, extTimeGroup: 1.5 }];
    expect(manualExtHoursFromLogs(logs)).toBe(1.5);
  });
  it("1:1 단일 일지, 개별연장 2h → 2h", () => {
    expect(manualExtHoursFromLogs([{ extTime1on1: 2, extTimeGroup: 0 }])).toBe(2);
  });
  it("개별연장은 훈련생별 합산 + 그룹은 max (혼합 드문 케이스)", () => {
    const logs = [{ extTime1on1: 1, extTimeGroup: 2 }, { extTime1on1: 1, extTimeGroup: 2 }];
    expect(manualExtHoursFromLogs(logs)).toBe(4); // sum(1on1)=2 + max(group)=2
  });
  it("빈 로그/비정상 값 방어 → 0", () => {
    expect(manualExtHoursFromLogs([])).toBe(0);
    expect(manualExtHoursFromLogs([{ extTime1on1: null, extTimeGroup: undefined }])).toBe(0);
  });
});

describe("computeOvertimeMinutes — 퇴근시각 기준 연장(분)", () => {
  it("전일(FULL_DAY): 저녁식사 18:00~19:00 무급 제외, 19:00 이후가 연장 → 21:00 퇴근=120분", () => {
    expect(computeOvertimeMinutes("FULL_DAY", kst(21, 0))).toBe(120);
  });
  it("전일: 19:00 정각 퇴근 = 연장 0(식사만 하고 종료)", () => {
    expect(computeOvertimeMinutes("FULL_DAY", kst(19, 0))).toBe(0);
  });
  it("오후(PM): 식사 공제 없음 — 종료 18:00 이후 전부 연장 → 19:30 퇴근=90분", () => {
    expect(computeOvertimeMinutes("PM", kst(19, 30), true)).toBe(90);
  });
  it("퇴근시각 없으면 0", () => {
    expect(computeOvertimeMinutes("FULL_DAY", null)).toBe(0);
  });
});

describe("overtimeMinutesForDay — 면제=수동입력 / 일반=퇴근시각 자동", () => {
  it("면제 배정: 수동입력 시간(2h) → 120분 (퇴근시각 무시)", () => {
    expect(overtimeMinutesForDay({ workType: "FULL_DAY", exempt: true, actualEndTime: null, manualExtHours: 2 })).toBe(120);
  });
  it("일반 배정: 퇴근시각 자동(전일 21:00) → 120분 (수동입력 무시)", () => {
    expect(overtimeMinutesForDay({ workType: "FULL_DAY", exempt: false, actualEndTime: kst(21, 0), manualExtHours: 5 })).toBe(120);
  });
});

describe("workEndMinutesForDay — 야간·휴일 가산용 실효 종료(벽시계 분)", () => {
  it("면제 전일 + 수동연장 4h: 고정종료 18:00 + 식사 60 + 240 = 23:00(1380)", () => {
    expect(workEndMinutesForDay({ workType: "FULL_DAY", exempt: true, scheduledEndMin: 18 * 60, manualExtHours: 4 })).toBe(23 * 60);
  });
  it("면제 오후 + 수동연장 5h: 식사 공제 없음 18:00 + 300 = 23:00(1380)", () => {
    expect(workEndMinutesForDay({ workType: "PM", exempt: true, scheduledEndMin: 18 * 60, manualExtHours: 5 })).toBe(23 * 60);
  });
  it("면제 + 연장 0: 고정 종료 그대로", () => {
    expect(workEndMinutesForDay({ workType: "FULL_DAY", exempt: true, scheduledEndMin: 18 * 60, manualExtHours: 0 })).toBe(18 * 60);
  });
  it("일반 배정: 실제 퇴근시각(21:00)과 고정종료 중 늦은 쪽", () => {
    expect(workEndMinutesForDay({ workType: "FULL_DAY", exempt: false, scheduledEndMin: 18 * 60, actualEndTime: kst(21, 0) })).toBe(21 * 60);
  });
  it("일반 배정 + 퇴근시각 없음: 고정 종료", () => {
    expect(workEndMinutesForDay({ workType: "FULL_DAY", exempt: false, scheduledEndMin: 18 * 60, actualEndTime: null })).toBe(18 * 60);
  });
  it("면제 전일 수동연장 4h → 야간창(22:00~24:00) 겹침 60분(22:00~23:00)", () => {
    const eNight = workEndMinutesForDay({ workType: "FULL_DAY", exempt: true, scheduledEndMin: 18 * 60, manualExtHours: 4 });
    const nightOverlap = Math.max(0, Math.min(eNight, 1440) - Math.max(9 * 60, 1320));
    expect(nightOverlap).toBe(60);
  });
});
