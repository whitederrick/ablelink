// 배정 취소(DELETE) — 조회 후 상태가 바뀌었으면(동시 수락) 덮어쓰지 않고 409 (2026-10-08 감사 P2)
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const findUnique = vi.fn();
const updateMany = vi.fn();
const auditFn = vi.fn(async () => undefined);

vi.mock("@/lib/prisma", () => ({ prisma: { siteAssignment: { findUnique, updateMany } } }));
vi.mock("@/lib/managerScope", () => ({
  requireAdminOrManagerSession: async () => ({ kind: "manager", agencyId: BigInt(1), managerId: BigInt(5) }),
  requireManagerSession: async () => ({ kind: "manager", agencyId: BigInt(1), managerId: BigInt(5) }),
}));
vi.mock("@/lib/audit", () => ({ audit: auditFn, auditSnapshot: async () => null }));

async function del() {
  const { DELETE } = await import("@/app/api/admin/assignments/[id]/route");
  const req = new NextRequest("http://localhost/api/admin/assignments/9", { method: "DELETE", body: JSON.stringify({ reason: "테스트" }) });
  return DELETE(req, { params: Promise.resolve({ id: "9" }) });
}

beforeEach(() => {
  findUnique.mockReset(); updateMany.mockReset(); auditFn.mockClear();
});

describe("DELETE /api/admin/assignments/[id]", () => {
  it("조회한 상태에서만 전이한다(where에 status 포함) — 동의 상태는 ENDED", async () => {
    findUnique.mockResolvedValue({ agencyId: BigInt(1), status: "ACTIVE" });
    updateMany.mockResolvedValue({ count: 1 });
    const res = await del();
    expect(res.status).toBe(200);
    const arg = updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: BigInt(9), status: "ACTIVE" });
    expect(arg.data.status).toBe("ENDED");
    expect(auditFn).toHaveBeenCalledTimes(1);
  });

  it("미동의 REQUESTED 취소는 EXPIRED", async () => {
    findUnique.mockResolvedValue({ agencyId: BigInt(1), status: "REQUESTED" });
    updateMany.mockResolvedValue({ count: 1 });
    await del();
    expect(updateMany.mock.calls[0][0].data.status).toBe("EXPIRED");
  });

  it("그 사이 워커가 수락해 상태가 바뀌었으면 409, 감사 기록 없음", async () => {
    findUnique.mockResolvedValue({ agencyId: BigInt(1), status: "REQUESTED" });
    updateMany.mockResolvedValue({ count: 0 });
    const res = await del();
    expect(res.status).toBe(409);
    expect(auditFn).not.toHaveBeenCalled();
  });
});
