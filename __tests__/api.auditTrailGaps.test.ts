// 감사 기록 누락 보완 (2026-10-08 감사 P2): 배정 후보 탈락, 운영자 계정 비밀번호 초기화
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const asgFindFirst = vi.fn();
const asgUpdateMany = vi.fn();
const adminFindUnique = vi.fn();
const adminUpdate = vi.fn();
const auditFn = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    siteAssignment: { findFirst: asgFindFirst, updateMany: asgUpdateMany },
    admin: { findUnique: adminFindUnique, update: adminUpdate },
  },
}));
vi.mock("@/lib/managerScope", () => ({
  requireManagerSession: async () => ({ kind: "manager", agencyId: BigInt(1), managerId: BigInt(5) }),
}));
vi.mock("@/lib/adminScope", () => ({
  requireAdminSession: async () => ({ kind: "admin", adminId: BigInt(2), loginId: "root" }),
  parseBigInt: (v: string) => (/^\d+$/.test(v) ? BigInt(v) : null),
}));
vi.mock("@/lib/audit", () => ({ audit: auditFn, auditSnapshot: async () => null }));
vi.mock("@/lib/tempPassword", () => ({ generateTempPassword: () => "TempPass-1234" }));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "hashed" } }));

beforeEach(() => {
  asgFindFirst.mockReset(); asgUpdateMany.mockReset(); adminFindUnique.mockReset(); adminUpdate.mockReset(); auditFn.mockClear();
});

async function rejectCandidate() {
  const { POST } = await import("@/app/api/admin/assignment-requests/route");
  const req = new NextRequest("http://localhost/api/admin/assignment-requests", { method: "POST", body: JSON.stringify({ action: "reject", assignmentId: "9" }) });
  return POST(req);
}

describe("배정 후보 탈락 감사 기록", () => {
  it("탈락 처리되면 누가·무엇을 기록한다", async () => {
    asgFindFirst.mockResolvedValue({ id: BigInt(9) });
    asgUpdateMany.mockResolvedValue({ count: 1 });
    const res = await rejectCandidate();
    expect(res.status).toBe(200);
    expect(auditFn).toHaveBeenCalledTimes(1);
    const entry = auditFn.mock.calls[0][1] as { entityType: string; summary: string };
    expect(entry.entityType).toBe("SiteAssignment");
    expect(entry.summary).toContain("탈락");
  });

  it("동시 처리로 실제 변경이 없었으면(count=0) 기록하지 않는다", async () => {
    asgFindFirst.mockResolvedValue({ id: BigInt(9) });
    asgUpdateMany.mockResolvedValue({ count: 0 });
    await rejectCandidate();
    expect(auditFn).not.toHaveBeenCalled();
  });
});

describe("운영자 계정 비밀번호 초기화 감사 기록", () => {
  it("기록은 남기되 임시 비밀번호 값은 어디에도 넣지 않는다", async () => {
    adminFindUnique.mockResolvedValue({ id: BigInt(3), loginId: "ops1", isActive: true });
    adminUpdate.mockResolvedValue({});
    const { PATCH } = await import("@/app/api/admin/system/admins/[id]/route");
    const req = new NextRequest("http://localhost/api/admin/system/admins/3", { method: "PATCH", body: JSON.stringify({ action: "reset-password" }) });
    const res = await PATCH(req, { params: Promise.resolve({ id: "3" }) });
    expect(res.status).toBe(200);
    expect(auditFn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(auditFn.mock.calls[0][1], (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(logged).toContain("비밀번호 초기화");
    expect(logged).not.toContain("TempPass-1234");
    expect(logged).not.toContain("hashed");
  });
});
