// 구독 라우트 동시성 — 2026-10-08 감사 P2: 동시 구독/플랜변경이 서로 다른 orderId로 이중 결제되던 문제.
//  1차: 기관 단위 락(두 번째 요청은 토스 호출 전에 409)  2차: billingEpoch CAS(경합 시 방금 결제 자동 전액 환불)
import { describe, it, expect, vi, beforeEach } from "vitest";

const agencyFind = vi.fn();
const txFn = vi.fn();
const refundFn = vi.fn();
const fetchFn = vi.fn();
const agencyUpdateMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agency: { findUnique: (...a: unknown[]) => agencyFind(...a), updateMany: (...a: unknown[]) => agencyUpdateMany(...a), update: vi.fn() },
    subscriptionPayment: { upsert: vi.fn(() => "upsert"), findFirst: vi.fn(async () => null), update: vi.fn(), updateMany: vi.fn() },
    $transaction: (...a: unknown[]) => txFn(...a),
  },
}));
vi.mock("@/lib/managerScope", () => ({
  requireManagerSession: async () => ({ managerId: BigInt(5), agencyId: BigInt(1), loginId: "m" }),
}));
vi.mock("@/lib/payments/tossRefund", () => ({ refundSubscriptionPayment: (...a: unknown[]) => refundFn(...a) }));
vi.mock("@/lib/outboundGuard", () => ({ outboundAllowed: () => true }));

import { POST } from "@/app/api/payments/billing/route";
import { acquireBillingLock, releaseBillingLock } from "@/lib/payments/billingLock";

const req = () =>
  new Request("http://x/api/payments/billing", {
    method: "POST",
    body: JSON.stringify({ agencyId: "1", planType: "STANDARD", authKey: "ak", customerKey: "agency_1" }),
  }) as never;

const ok = (body: object) => ({ ok: true, json: async () => body });

describe("POST /api/payments/billing — 동시성 방어", () => {
  beforeEach(async () => {
    agencyFind.mockReset(); txFn.mockReset(); refundFn.mockReset(); fetchFn.mockReset(); agencyUpdateMany.mockReset();
    await releaseBillingLock(BigInt(1));
    agencyFind.mockResolvedValue({ planType: "FREE", billingCycle: "MONTHLY", customAmount: null, billingEpoch: 3 });
    fetchFn
      .mockResolvedValueOnce(ok({ billingKey: "bk" })) // 빌링키 발급
      .mockResolvedValueOnce(ok({ paymentKey: "pk", orderId: "o" })); // 결제
    vi.stubGlobal("fetch", fetchFn);
  });

  it("정상: 200, billingEpoch 조건부 활성화, 끝나면 락 해제", async () => {
    txFn.mockResolvedValue([{ id: BigInt(9), amount: 99000 }, { count: 1 }]);
    const res = await POST(req());
    expect(res.status).toBe(200);
    const updateManyArg = agencyUpdateMany.mock.calls[0][0];
    expect(updateManyArg.where).toEqual({ id: BigInt(1), billingEpoch: 3 });
    expect(updateManyArg.data.billingEpoch).toEqual({ increment: 1 });
    expect(await acquireBillingLock(BigInt(1))).toBe(true); // 해제되어 재획득 가능
  });

  it("다른 변경이 진행 중이면 토스를 한 번도 호출하지 않고 409", async () => {
    expect(await acquireBillingLock(BigInt(1))).toBe(true); // 다른 요청이 락 보유
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(agencyFind).not.toHaveBeenCalled();
  });

  it("CAS 경합(count=0): 방금 결제를 전액 환불하고 409, 락 해제", async () => {
    txFn.mockResolvedValue([{ id: BigInt(9), amount: 99000 }, { count: 0 }]);
    refundFn.mockResolvedValue({ ok: true, refundedAmount: 99000 });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(refundFn).toHaveBeenCalledWith(expect.objectContaining({ paymentId: BigInt(9), amount: 99000, kind: "CONFLICT" }));
    expect(await acquireBillingLock(BigInt(1))).toBe(true);
  });

  it("CAS 경합 + 환불 실패: 500으로 수동 환불 안내(성공 처리하지 않음)", async () => {
    txFn.mockResolvedValue([{ id: BigInt(9), amount: 99000 }, { count: 0 }]);
    refundFn.mockResolvedValue({ ok: false, reason: "toss down" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req());
    err.mockRestore();
    expect(res.status).toBe(500);
    expect((await res.json()).success).toBe(false);
  });

  it("처리 중 예외가 나도 락이 해제된다(다음 요청이 영구히 막히지 않음)", async () => {
    fetchFn.mockReset();
    fetchFn.mockRejectedValue(new Error("network"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req());
    err.mockRestore();
    expect(res.status).toBe(500);
    expect(await acquireBillingLock(BigInt(1))).toBe(true);
  });
});
