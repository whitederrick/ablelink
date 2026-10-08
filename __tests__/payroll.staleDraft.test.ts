// 급여 초안 계산 이후 입력 변경 판정 (2026-10-08 감사 P2)
import { describe, it, expect, vi } from "vitest";
import { countStaleInputs, staleDraftMessage } from "@/lib/payroll/staleDraft";

function fakeDb(att: number, leave: number) {
  const dailyAttendance = { count: vi.fn(async () => att) };
  const annualLeaveEntry = { count: vi.fn(async (_args?: { where: Record<string, unknown> }) => leave) };
  return { dailyAttendance, annualLeaveEntry } as unknown as Parameters<typeof countStaleInputs>[0] & {
    dailyAttendance: typeof dailyAttendance; annualLeaveEntry: typeof annualLeaveEntry;
  };
}
const since = new Date("2026-11-30T10:00:00.000Z");

describe("countStaleInputs", () => {
  it("근태·연차 변경 건수를 합산한다", async () => {
    const r = await countStaleInputs(fakeDb(2, 1), { agencyId: BigInt(1), yearMonth: "2026-11", since });
    expect(r).toEqual({ attendance: 2, leave: 1, total: 3 });
  });

  it("변경이 없으면 total 0", async () => {
    const r = await countStaleInputs(fakeDb(0, 0), { agencyId: BigInt(1), yearMonth: "2026-11", since });
    expect(r.total).toBe(0);
  });

  it("기관·월·계산시각 기준으로만 센다(급여가 읽는 행 한정)", async () => {
    const db = fakeDb(0, 0);
    await countStaleInputs(db, { agencyId: BigInt(7), yearMonth: "2026-02", since });
    expect(db.dailyAttendance.count).toHaveBeenCalledWith({
      where: {
        assignment: { agencyId: BigInt(7) }, workDate: { gte: "2026-02-01", lte: "2026-02-31" },
        isFinalClosed: true, startTime: { not: null }, updatedAt: { gt: since },
      },
    });
    const lw = db.annualLeaveEntry.count.mock.calls[0][0]!.where;
    expect(lw.agencyId).toBe(BigInt(7));
    expect(lw.kind).toBe("USE");
    expect(lw.effectiveDate).toEqual({ gte: new Date("2026-02-01T00:00:00.000Z"), lte: new Date("2026-02-28T00:00:00.000Z") });
    expect(lw.createdAt).toEqual({ gt: since });
  });
});

describe("staleDraftMessage", () => {
  it("변경된 종류만 안내한다", () => {
    expect(staleDraftMessage({ attendance: 3, leave: 0, total: 3 })).toContain("근태 3건");
    expect(staleDraftMessage({ attendance: 3, leave: 0, total: 3 })).not.toContain("연차");
    expect(staleDraftMessage({ attendance: 1, leave: 2, total: 3 })).toContain("근태 1건·연차 사용 2건");
  });
});
