// 문서 재제출 시 공단 제출 상태 — 2026-10-08 감사 P2: 공단 제출완료(SUBMITTED) 문서를 고쳐 재제출해도 '제출완료'로 남던 문제.
import { describe, it, expect, vi, beforeEach } from "vitest";

const runFindFirst = vi.fn();
const runUpdate = vi.fn();

const tx = {
  $executeRaw: vi.fn(async () => 1),
  siteAssignment: { findUnique: vi.fn(async () => ({ agencyId: BigInt(1) })) },
  documentRun: { findFirst: (...a: unknown[]) => runFindFirst(...a), create: vi.fn(), update: (...a: unknown[]) => runUpdate(...a) },
  documentVersion: { aggregate: vi.fn(async () => ({ _max: { versionNo: 1 } })), create: vi.fn(async () => ({ id: BigInt(50), versionNo: 2 })) },
  documentSubmissionLog: { create: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    documentVersion: { findMany: vi.fn(async () => []), deleteMany: vi.fn() },
    manager: { findMany: vi.fn(async () => []) },
    managerNotice: { createMany: vi.fn() },
  },
}));
vi.mock("@/app/worker/_lib/session", () => ({ getWorkerSessionFromReq: async () => ({ workerId: "5" }) }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
const buildFn = vi.fn(async () => ({
  payload: { writtenYMD: "2026-10-08" },
  meta: { workerName: "홍", assignmentId: BigInt(22), siteId: BigInt(2), traineeId: null, traineeName: null },
}));
vi.mock("@/lib/docs/buildDocPayload", () => ({
  DocPayloadError: class extends Error { status = 400; extra = {}; },
  buildDocPayload: (...a: unknown[]) => (buildFn as (...x: unknown[]) => unknown)(...a),
}));

import { POST } from "@/app/api/worker/docs/submit/route";

const submit = (periodStart = "2026-10-01", periodEnd = "2026-10-31") =>
  POST(new Request("http://x/api/worker/docs/submit", {
    method: "POST",
    body: JSON.stringify({ periodStart, periodEnd, documents: [{ docType: "ATTENDANCE_SHEET" }] }),
  }) as never);

describe("POST /api/worker/docs/submit — 재제출과 공단 제출 상태", () => {
  beforeEach(() => { runFindFirst.mockReset(); runUpdate.mockReset(); buildFn.mockClear(); });

  it("공단 제출완료(SUBMITTED) 문서를 재제출하면 재제출 요구(RESUBMIT)로 되돌린다", async () => {
    runFindFirst.mockResolvedValue({ id: BigInt(9), govStatus: "SUBMITTED" });
    expect((await submit()).status).toBe(200);
    expect(runUpdate.mock.calls[0][0].data).toMatchObject({ signStage: "SUBMITTED", govStatus: "RESUBMIT" });
  });

  it("미제출(NONE)·이미 재제출 요구(RESUBMIT)는 상태를 건드리지 않는다", async () => {
    for (const st of ["NONE", "RESUBMIT"]) {
      runUpdate.mockReset();
      runFindFirst.mockResolvedValue({ id: BigInt(9), govStatus: st });
      await submit();
      expect(runUpdate.mock.calls[0][0].data).not.toHaveProperty("govStatus");
    }
  });

  it("이력(제출시각·발송 횟수)은 유지 — 덮어쓰지 않는다", async () => {
    runFindFirst.mockResolvedValue({ id: BigInt(9), govStatus: "SUBMITTED" });
    await submit();
    const data = runUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("govSubmittedAt");
    expect(data).not.toHaveProperty("govSubmitCount");
  });

  it("기간 상한: 0001-01-01~9999-12-31 같은 무한 기간은 400이고 payload 생성조차 시작하지 않는다", async () => {
    const res = await submit("0001-01-01", "9999-12-31");
    expect(res.status).toBe(400);
    expect(buildFn).not.toHaveBeenCalled();
  });

  it("기간 역전(시작>종료)도 400", async () => {
    expect((await submit("2026-10-31", "2026-10-01")).status).toBe(400);
  });
});
