// PATCH /api/worker/logs/[id] — 2026-10-08 감사 P3: 이 경로만 지도사항 800자 상한을 우회할 수 있었다.
import { describe, it, expect, vi, beforeEach } from "vitest";

const logFindUnique = vi.fn();
const logUpdate = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { traineeLog: { findUnique: (...a: unknown[]) => logFindUnique(...a), update: (...a: unknown[]) => logUpdate(...a) } } }));
vi.mock("@/app/worker/_lib/session", () => ({ getWorkerSessionFromReq: async () => ({ workerId: "5" }) }));

import { PATCH } from "@/app/api/worker/logs/[id]/route";
import { MAX_LOG_TEXT_LEN } from "@/lib/docs/logTextLimit";

const patch = (content: unknown) =>
  PATCH(new Request("http://x/api/worker/logs/10", { method: "PATCH", body: JSON.stringify({ content }) }) as never, { params: Promise.resolve({ id: "10" }) });

describe("PATCH /api/worker/logs/[id] — 길이 상한", () => {
  beforeEach(() => {
    logFindUnique.mockReset(); logUpdate.mockReset();
    logFindUnique.mockResolvedValue({ writerId: BigInt(5), isCompleted: true });
    logUpdate.mockResolvedValue({});
  });

  it("상한 이하는 저장", async () => {
    const res = await patch("가".repeat(MAX_LOG_TEXT_LEN));
    expect(res.status).toBe(200);
    expect(logUpdate).toHaveBeenCalledTimes(1);
  });

  it("상한 초과는 400이고 저장하지 않는다", async () => {
    const res = await patch("가".repeat(MAX_LOG_TEXT_LEN + 1));
    expect(res.status).toBe(400);
    expect(logUpdate).not.toHaveBeenCalled();
  });
});
