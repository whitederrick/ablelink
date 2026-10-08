// 일지 일괄 저장 — 2026-10-08 감사 P2: ①오늘·미래 날짜 말없는 누락 ②덮어쓰기가 연장·인정시간·과제 행을 남김
//  ③덮어쓰기 확인창에 어차피 건너뛸(미재적) 일지가 섞임.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const asgFind = vi.fn();
const placementFind = vi.fn();
const attFindMany = vi.fn();
const attCreateMany = vi.fn();
const logFindMany = vi.fn();
const logUpdate = vi.fn();
const logCreate = vi.fn();
const taskDeleteMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteAssignment: { findUnique: (...a: unknown[]) => asgFind(...a) },
    traineePlacement: { findMany: (...a: unknown[]) => placementFind(...a) },
    dailyAttendance: { findMany: (...a: unknown[]) => attFindMany(...a), createMany: (...a: unknown[]) => attCreateMany(...a) },
    traineeLog: { findMany: (...a: unknown[]) => logFindMany(...a), update: (...a: unknown[]) => logUpdate(...a), create: (...a: unknown[]) => logCreate(...a), findFirst: vi.fn() },
    traineeLogTask: { deleteMany: (...a: unknown[]) => taskDeleteMany(...a) },
  },
}));
vi.mock("@/app/worker/_lib/session", () => ({ getWorkerSessionFromReq: async () => ({ workerId: "5" }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { POST } from "@/app/api/worker/logs/batch-save/route";

const SITE = BigInt(2);
const span = (traineeId: number, start: string) => ({ traineeId: BigInt(traineeId), siteId: SITE, startDate: new Date(`${start}T00:00:00+09:00`), endDate: null });
const post = (body: Record<string, unknown>) =>
  POST(new Request("http://x/api/worker/logs/batch-save", { method: "POST", body: JSON.stringify({ assignmentId: "22", ...body }) }) as never);

describe("POST /api/worker/logs/batch-save", () => {
  beforeEach(() => {
    [asgFind, placementFind, attFindMany, attCreateMany, logFindMany, logUpdate, logCreate, taskDeleteMany].forEach((m) => m.mockReset());
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T03:00:00.000Z")); // KST 2026-10-08 12:00
    asgFind.mockResolvedValue({ workerId: BigInt(5), siteId: SITE, startDate: null, endDate: null });
    placementFind.mockResolvedValue([span(7, "2026-01-01")]);
    attFindMany.mockResolvedValue([]);
    logFindMany.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it("출근기록 없는 오늘 날짜는 조용히 버리지 않고 skippedNoAttendance·message로 알린다(saved 0)", async () => {
    const res = await post({ logs: [{ date: "2026-10-08", traineeId: "7", content: "x" }] });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.saved).toBe(0);
    expect(body.skippedNoAttendance).toEqual(["2026-10-08"]);
    expect(body.message).toContain("2026-10-08");
    expect(attCreateMany).not.toHaveBeenCalled();
  });

  it("덮어쓰기: 연장·인정시간을 0으로 되돌리고 옛 과제 행(측정시간·특이사항)을 삭제", async () => {
    attFindMany.mockResolvedValue([{ id: BigInt(900), workDate: "2026-10-05" }]);
    logFindMany.mockResolvedValue([{ id: BigInt(100), attendanceId: BigInt(900), traineeId: BigInt(7) }]);
    logUpdate.mockResolvedValue({});
    const res = await post({ overwrite: true, logs: [{ date: "2026-10-05", traineeId: "7", content: "새 내용", time1on1: 4 }] });
    expect((await res.json()).saved).toBe(1);
    const data = logUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ extTime1on1: 0, extTimeGroup: 0, totalRecognizedTime: 0, content: "새 내용", isCompleted: true });
    expect(taskDeleteMany).toHaveBeenCalledWith({ where: { logId: BigInt(100) } });
  });

  it("신규 일지는 과제 행 삭제 없이 생성(기존 동작)", async () => {
    attFindMany.mockResolvedValue([{ id: BigInt(900), workDate: "2026-10-05" }]);
    logCreate.mockResolvedValue({});
    await post({ overwrite: true, logs: [{ date: "2026-10-05", traineeId: "7", content: "신규" }] });
    expect(logCreate).toHaveBeenCalledTimes(1);
    expect(taskDeleteMany).not.toHaveBeenCalled();
  });

  it("덮어쓰기 확인창 목록에서 그날 미재적(어차피 건너뜀) 훈련생 일지는 제외", async () => {
    placementFind.mockResolvedValue([span(7, "2026-01-01"), span(8, "2026-10-07")]); // 8은 10/07부터 재적 → 10/05 미재적
    attFindMany.mockResolvedValue([{ id: BigInt(900), workDate: "2026-10-05" }]);
    logFindMany.mockResolvedValue([
      { attendanceId: BigInt(900), traineeId: BigInt(7), isCompleted: true },
      { attendanceId: BigInt(900), traineeId: BigInt(8), isCompleted: false },
    ]);
    const res = await post({ logs: [{ date: "2026-10-05", traineeId: "7" }, { date: "2026-10-05", traineeId: "8" }] });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("OVERWRITE_CONFIRM");
    expect(body.conflicts.map((c: { traineeId: string }) => c.traineeId)).toEqual(["7"]);
  });
});
