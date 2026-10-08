// 미작성 일지 목록의 날짜 상한 — 2026-10-08 감사 P2: 미리 써 둔 미래 날짜가 "미작성"으로 잡히던 문제.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findMany = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { dailyAttendance: { findMany: (...a: unknown[]) => findMany(...a) } } }));

import { getMissingLogItems } from "@/lib/worker/missingLogs";

describe("getMissingLogItems — 날짜 상한", () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T15:30:00.000Z")); // KST 2026-10-09 00:30 (UTC 날짜와 KST 날짜가 다른 시각)
  });
  afterEach(() => vi.useRealTimers());

  it("기본 상한은 오늘(KST) — UTC가 아니라 KST 날짜로 계산", async () => {
    await getMissingLogItems(BigInt(1), "2026-07-09");
    expect(findMany.mock.calls[0][0].where).toEqual({ workerId: BigInt(1), workDate: { gte: "2026-07-09", lte: "2026-10-09" } });
  });

  it("호출자가 상한을 지정하면 그대로 사용", async () => {
    await getMissingLogItems(BigInt(1), "2026-07-09", 30, "2026-10-01");
    expect(findMany.mock.calls[0][0].where.workDate.lte).toBe("2026-10-01");
  });
});
