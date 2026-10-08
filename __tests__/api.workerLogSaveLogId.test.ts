// 일지 수정 모드(logId) 출근기록 해석 — 2026-10-08 감사 P2.
//  쿠키의 활성 배정(body)이 아니라 일지가 이미 붙은 출근기록·배정을 기준으로 삼아야 한다.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logFindUnique = vi.fn();
const attFindFirst = vi.fn();
const attFindUnique = vi.fn();
const attCreate = vi.fn();
const logFindFirst = vi.fn();
const logUpdate = vi.fn();
const asgFindUnique = vi.fn();
const logCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    traineeLog: { findUnique: (...a: unknown[]) => logFindUnique(...a), findFirst: (...a: unknown[]) => logFindFirst(...a), update: (...a: unknown[]) => logUpdate(...a), create: (...a: unknown[]) => logCreate(...a) },
    dailyAttendance: { findFirst: (...a: unknown[]) => attFindFirst(...a), findUnique: (...a: unknown[]) => attFindUnique(...a), create: (...a: unknown[]) => attCreate(...a) },
    siteAssignment: { findUnique: (...a: unknown[]) => asgFindUnique(...a) },
    traineeLogTask: { deleteMany: vi.fn(), create: vi.fn() },
  },
}));
vi.mock("@/app/worker/_lib/session", () => ({ getWorkerSessionFromReq: async () => ({ workerId: "5" }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/docs/traineeSiteGuard", () => ({ findTraineeAtSiteInPeriod: async () => ({ id: BigInt(1) }) }));

import { POST } from "@/app/api/worker/logs/save/route";

const W = BigInt(5);
// 일지 100: 현장 B(배정 22)의 2026-10-05 출근기록(att 900)에 붙은 임시저장
const curLog = { writerId: W, attendanceId: BigInt(900), attendance: { workDate: "2026-10-05", assignmentId: BigInt(22), siteId: BigInt(2) } };

const post = (body: Record<string, unknown>) =>
  POST(new Request("http://x/api/worker/logs/save", { method: "POST", body: JSON.stringify({ traineeId: "7", content: "내용", ...body }) }) as never);

describe("POST /api/worker/logs/save — logId 모드", () => {
  beforeEach(() => {
    [logFindUnique, attFindFirst, attFindUnique, attCreate, logFindFirst, logUpdate, asgFindUnique, logCreate].forEach((m) => m.mockReset());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00.000Z"));
    logFindUnique.mockImplementation(async (a: { select?: object }) => (a.select ? curLog : { id: BigInt(100), writerId: W, isCompleted: false }));
    attFindUnique.mockResolvedValue({ workerId: W, siteId: BigInt(2), workDate: "2026-10-05" });
    logFindFirst.mockResolvedValue(null);
    logUpdate.mockResolvedValue({ id: BigInt(100) });
  });
  afterEach(() => vi.useRealTimers());

  it("같은 날짜 저장: 쿠키가 다른 현장(A·배정11)을 가리켜도 출근기록을 새로 만들지 않고 일지의 출근기록(900)을 쓴다", async () => {
    const res = await post({ logId: "100", logDate: "2026-10-05", siteId: "1", assignmentId: "11" });
    expect(res.status).toBe(200);
    expect(attCreate).not.toHaveBeenCalled();
    expect(attFindFirst).not.toHaveBeenCalled();
    expect(logUpdate.mock.calls[0][0].data.attendanceId).toBe(BigInt(900));
  });

  it("logDate 누락: 오늘로 이동시키지 않고 일지의 날짜를 유지", async () => {
    const res = await post({ logId: "100", siteId: "1", assignmentId: "11" });
    expect(res.status).toBe(200);
    expect(attCreate).not.toHaveBeenCalled();
    expect(logUpdate.mock.calls[0][0].data.attendanceId).toBe(BigInt(900));
  });

  it("날짜 이동: 쿠키가 아니라 일지의 배정(22)·현장(2)으로 새 날짜 출근기록을 찾는다/만든다", async () => {
    attFindFirst.mockResolvedValue(null);
    asgFindUnique.mockResolvedValue({ workerId: W, siteId: BigInt(2), startDate: null, endDate: null });
    attCreate.mockResolvedValue({ id: BigInt(901) });
    const res = await post({ logId: "100", logDate: "2026-10-06", siteId: "1", assignmentId: "11" });
    expect(res.status).toBe(200);
    expect(attFindFirst.mock.calls[0][0].where).toEqual({ assignmentId: BigInt(22), workDate: "2026-10-06" });
    expect(attCreate.mock.calls[0][0].data).toEqual({ workerId: W, siteId: BigInt(2), assignmentId: BigInt(22), workDate: "2026-10-06" });
  });

  it("남의 일지면 출근기록을 만들기 전에 403", async () => {
    logFindUnique.mockImplementation(async () => ({ ...curLog, writerId: BigInt(99) }));
    const res = await post({ logId: "100", logDate: "2026-10-06", siteId: "1", assignmentId: "11" });
    expect(res.status).toBe(403);
    expect(attCreate).not.toHaveBeenCalled();
    expect(attFindFirst).not.toHaveBeenCalled();
  });

  it("없는 일지는 404(출근기록 생성 없음)", async () => {
    logFindUnique.mockResolvedValue(null);
    const res = await post({ logId: "100", logDate: "2026-10-06" });
    expect(res.status).toBe(404);
    expect(attCreate).not.toHaveBeenCalled();
  });

  it("신규 저장이 동시 생성과 충돌(P2002)해도 overwrite 확인 없이 덮어쓰지 않고 LOG_EXISTS 409", async () => {
    logFindFirst.mockResolvedValueOnce(null) // 존재 확인 시점엔 없었음
      .mockResolvedValueOnce({ id: BigInt(55), isCompleted: false }); // 그 사이 다른 기기가 먼저 생성
    logCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const res = await post({ attendanceId: "900" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("LOG_EXISTS");
    expect(logUpdate).not.toHaveBeenCalled();
  });

  it("같은 경합이라도 사용자가 overwrite를 확인했으면 기존 일지를 갱신", async () => {
    logFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: BigInt(55), isCompleted: false });
    logCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const res = await post({ attendanceId: "900", overwrite: true });
    expect(res.status).toBe(200);
    expect(logUpdate.mock.calls[0][0].where).toEqual({ id: BigInt(55) });
  });
});
