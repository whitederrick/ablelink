// 해지 라우트도 구독/플랜변경과 같은 기관 락을 공유한다 — 겹쳐 실행되면 환불 대상이 어긋난다(2026-10-08 감사 P2).
import { describe, it, expect, vi, beforeEach } from "vitest";

const agencyFind = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { agency: { findUnique: (...a: unknown[]) => agencyFind(...a) } } }));
vi.mock("@/lib/managerScope", () => ({
  requireManagerSession: async () => ({ managerId: BigInt(5), agencyId: BigInt(2), loginId: "m" }),
}));

import { POST } from "@/app/api/payments/cancel/route";
import { acquireBillingLock, releaseBillingLock } from "@/lib/payments/billingLock";

const req = () => new Request("http://x/api/payments/cancel", { method: "POST" }) as never;

describe("POST /api/payments/cancel — 기관 락", () => {
  beforeEach(async () => {
    agencyFind.mockReset();
    await releaseBillingLock(BigInt(2));
  });

  it("구독/플랜변경이 진행 중이면 DB·토스를 건드리지 않고 409", async () => {
    expect(await acquireBillingLock(BigInt(2))).toBe(true);
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(agencyFind).not.toHaveBeenCalled();
  });

  it("무료 기관 해지 호출(400)로 끝나도 락을 반드시 해제한다", async () => {
    agencyFind.mockResolvedValue({ planType: "FREE" });
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect(await acquireBillingLock(BigInt(2))).toBe(true);
  });
});
