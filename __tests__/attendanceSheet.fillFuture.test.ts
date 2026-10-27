// 출근부 작성일 지정 시 '오늘~작성일' 근무일 미리 채우기 — DB 쓰기 없이 문서 값만 만든다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({
  attendance: [] as Record<string, unknown>[],
  holidays: [] as Record<string, unknown>[],
  leaves: [] as Record<string, unknown>[],
  assignments: [] as Record<string, unknown>[],
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    dailyAttendance: { findMany: async () => db.attendance },
    siteHoliday: { findMany: async () => db.holidays },
    traineePlacement: { findMany: async () => [] },
    site: { findUnique: async () => ({ lateThresholdMin: null, agencyId: null }) },
    agency: { findUnique: async () => null },
    annualLeaveEntry: { findMany: async () => db.leaves, aggregate: async () => ({ _sum: { days: 0 } }) },
    siteAssignment: { findMany: async () => db.assignments },
  },
}));

import { buildAttendanceSheetPayload } from "@/lib/docs/attendanceSheetPayload";

const sig = { name: "", imageUrl: undefined };
const args = (extra: { writtenYMD?: string } = {}) => ({
  workerId: BigInt(1), siteId: BigInt(1), start: "2026-10-01", end: "2026-10-31", companyName: "T", workerName: "W", workerPhone: "0",
  fallbackAssignment: { workType: "FULL_DAY", commuteGuidanceIncluded: true, customWorkStart: null, customWorkEnd: null, attendanceButtonExempt: false },
  signatures: { govAgent: sig, companyManager: sig, worker: sig },
  ...extra,
});
type Entry = { date: string };
const dates = (r: { payload: { entries: Entry[] } }): string[] => r.payload.entries.map((e) => e.date);

describe("출근부 미리 채우기(작성일 지정)", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T03:00:00Z")); // KST 10/27(화)
    db.attendance = []; db.holidays = []; db.leaves = [];
    db.assignments = [{ startDate: null, endDate: null }];
  });
  afterEach(() => vi.useRealTimers());

  it("작성일을 지정하지 않으면 종전과 같다 — 미래를 채우지 않는다", async () => {
    expect(dates(await buildAttendanceSheetPayload(args()))).toEqual([]);
  });

  it("작성일=말일이면 오늘(10/27)부터 말일까지 평일만 채운다(주말 제외, 지난 날은 채우지 않음)", async () => {
    const r = await buildAttendanceSheetPayload(args({ writtenYMD: "2026-10-31" }));
    expect(dates(r)).toEqual(["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    expect(r.payload.entries[0]).toMatchObject({ start: "09:00", end: "18:00", hours: 8, pending: false });
    expect(r.payload.totalHours).toBe(32);
  });

  it("작성일이 중간이면 거기까지만", async () => {
    expect(dates(await buildAttendanceSheetPayload(args({ writtenYMD: "2026-10-28" })))).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("작성일이 이미 지난 날이면 채우지 않는다(지난 빈 칸은 '기록 누락' 신호)", async () => {
    expect(dates(await buildAttendanceSheetPayload(args({ writtenYMD: "2026-10-20" })))).toEqual([]);
  });

  it("휴무일·연차 사용일·기존 출근 기록이 있는 날은 건드리지 않는다", async () => {
    db.holidays = [{ assignmentId: BigInt(1), date: "2026-10-28", reason: "휴가" }];
    db.leaves = [{ effectiveDate: new Date("2026-10-29T00:00:00Z") }];
    db.attendance = [{ workDate: "2026-10-27", assignmentId: BigInt(1), startTime: new Date("2026-10-27T00:00:00Z"), endTime: new Date("2026-10-27T09:00:00Z"),
      actualStartTime: null, actualEndTime: null, payrollConfirmedAt: null, logs: [], assignment: null }];
    const r = await buildAttendanceSheetPayload(args({ writtenYMD: "2026-10-31" }));
    expect(dates(r).filter((d) => d !== "2026-10-27")).toEqual(["2026-10-30"]);
  });

  it("배정 기간 밖의 날은 채우지 않는다", async () => {
    db.assignments = [{ startDate: new Date("2026-09-01T00:00:00+09:00"), endDate: new Date("2026-10-28T00:00:00+09:00") }];
    expect(dates(await buildAttendanceSheetPayload(args({ writtenYMD: "2026-10-31" })))).toEqual(["2026-10-27", "2026-10-28"]);
  });
});
