// 현장 출퇴근 면제 일괄 변경 — 2026-10-08 감사 P2: 같은 현장의 타 기관 배정까지 바뀌던 테넌시 결함.
import { describe, it, expect, vi, beforeEach } from "vitest";

const siteFind = vi.fn();
const updateMany = vi.fn();
const auditFn = vi.fn();
const sessionFn = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { site: { findUnique: (...a: unknown[]) => siteFind(...a) }, siteAssignment: { updateMany: (...a: unknown[]) => updateMany(...a) } },
}));
vi.mock("@/lib/managerScope", () => ({ requireAdminOrManagerSession: (...a: unknown[]) => sessionFn(...a) }));
vi.mock("@/lib/audit", () => ({ audit: (...a: unknown[]) => auditFn(...a) }));

import { PATCH } from "@/app/api/admin/sites/[id]/attendance-exempt/route";

const call = (exempt: unknown, id = "10") =>
  PATCH(
    new Request("http://x/api/admin/sites/10/attendance-exempt", { method: "PATCH", body: JSON.stringify({ exempt }) }) as never,
    { params: Promise.resolve({ id }) },
  );

describe("PATCH /api/admin/sites/[id]/attendance-exempt", () => {
  beforeEach(() => {
    siteFind.mockReset(); updateMany.mockReset(); auditFn.mockReset(); sessionFn.mockReset();
    siteFind.mockResolvedValue({ agencyId: BigInt(1), isActive: true });
    updateMany.mockResolvedValue({ count: 2 });
  });

  it("매니저: 자기 기관(agencyId) 배정만 갱신 — 타 기관 배정 제외 + 감사 기록", async () => {
    sessionFn.mockResolvedValue({ kind: "manager", managerId: BigInt(5), agencyId: BigInt(1), loginId: "m" });
    const res = await call(true);
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { siteId: BigInt(10), status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] }, agencyId: BigInt(1) },
      data: { attendanceButtonExempt: true },
    });
    expect(auditFn).toHaveBeenCalledTimes(1);
  });

  it("운영자: 기관 필터 없이 현장 전체(기존 동작 유지) + 감사 기록", async () => {
    sessionFn.mockResolvedValue({ kind: "admin", adminId: BigInt(1), loginId: "a" });
    await call(false);
    expect(updateMany.mock.calls[0][0].where).toEqual({ siteId: BigInt(10), status: { in: ["ASSIGNED", "CONFIRMED", "ACTIVE"] } });
    expect(updateMany.mock.calls[0][0].data).toEqual({ attendanceButtonExempt: false });
    expect(auditFn).toHaveBeenCalledTimes(1);
  });

  it("다른 기관 소유 현장을 지정한 매니저는 기존대로 403이며 아무것도 갱신하지 않는다", async () => {
    sessionFn.mockResolvedValue({ kind: "manager", managerId: BigInt(5), agencyId: BigInt(2), loginId: "m" });
    const res = await call(true);
    expect(res.status).toBe(403);
    expect(updateMany).not.toHaveBeenCalled();
    expect(auditFn).not.toHaveBeenCalled();
  });

  it("exempt가 true가 아니면 해제로 처리(기존 동작)", async () => {
    sessionFn.mockResolvedValue({ kind: "manager", managerId: BigInt(5), agencyId: BigInt(1), loginId: "m" });
    await call("yes");
    expect(updateMany.mock.calls[0][0].data).toEqual({ attendanceButtonExempt: false });
  });
});
