// 정기결제 크론 × 해지/구독 변경 경합 — 2026-10-08 감사 P2.
//  해지의 환불~강등 사이에 크론이 새 주기를 청구하면 그 결제가 환불 없이 supersede 되던 문제:
//  크론은 기관 락을 공유하고, 락 획득 뒤 최신 상태를 다시 확인해 낡은 스냅샷으로 청구하지 않는다.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.CRON_SECRET = "cron-secret-for-test";
  process.env.TOSS_PAYMENTS_SECRET_KEY = "sk_test";
});

const agencyFindMany = vi.fn();
const agencyFindUnique = vi.fn();
const txFn = vi.fn();
const fetchFn = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agency: { findMany: (...a: unknown[]) => agencyFindMany(...a), findUnique: (...a: unknown[]) => agencyFindUnique(...a), updateMany: vi.fn(async () => ({ count: 1 })) },
    subscriptionPayment: { upsert: vi.fn(() => "upsert") },
    $transaction: (...a: unknown[]) => txFn(...a),
  },
}));
vi.mock("@/lib/outboundGuard", () => ({ outboundAllowed: () => true }));

import { POST } from "@/app/api/payments/charge/route";
import { acquireBillingLock, releaseBillingLock } from "@/lib/payments/billingLock";

const NEXT = new Date("2026-10-01T00:00:00.000Z");
const snapshot = () => ({
  id: BigInt(7), name: "테스트기관", planType: "STANDARD", billingCycle: "MONTHLY", customAmount: null,
  tossBillingKey: "bk", tossCustomerKey: "ck", nextBillingAt: NEXT, subscribedAt: new Date("2026-01-01T00:00:00.000Z"),
});
const req = () => new Request("http://x/api/payments/charge", { method: "POST", headers: { "x-cron-secret": "cron-secret-for-test" } }) as never;
const run = async () => (await (await POST(req())).json()) as { results: { status: string }[] };

describe("POST /api/payments/charge — 해지/변경과의 경합 방어", () => {
  beforeEach(async () => {
    agencyFindMany.mockReset(); agencyFindUnique.mockReset(); txFn.mockReset(); fetchFn.mockReset();
    await releaseBillingLock(BigInt(7));
    agencyFindMany.mockResolvedValue([snapshot()]);
    agencyFindUnique.mockResolvedValue({ planType: "STANDARD", tossBillingKey: "bk", nextBillingAt: NEXT });
    fetchFn.mockResolvedValue({ ok: true, json: async () => ({ paymentKey: "pk" }) });
    txFn.mockResolvedValue([{}, { count: 1 }]);
    vi.stubGlobal("fetch", fetchFn);
  });

  it("정상: 결제 성공 처리 후 락 해제", async () => {
    const out = await run();
    expect(out.results[0].status).toBe("success");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await acquireBillingLock(BigInt(7))).toBe(true);
  });

  it("해지/구독 변경이 락을 쥐고 있으면 토스를 호출하지 않고 건너뛴다(결제일 미변경)", async () => {
    expect(await acquireBillingLock(BigInt(7))).toBe(true); // 해지 처리 중
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await run();
    warn.mockRestore();
    expect(out.results[0].status).toBe("skipped_busy");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(txFn).not.toHaveBeenCalled();
  });

  it("락 획득 전 스냅샷이 낡아(그 사이 해지로 FREE) 있으면 청구하지 않는다", async () => {
    agencyFindUnique.mockResolvedValue({ planType: "FREE", tossBillingKey: null, nextBillingAt: null });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await run();
    warn.mockRestore();
    expect(out.results[0].status).toBe("skipped_stale");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await acquireBillingLock(BigInt(7))).toBe(true); // 건너뛰어도 락은 해제
  });

  it("그 사이 쌍둥이 크론이 결제일을 전진시켰어도 청구하지 않는다", async () => {
    agencyFindUnique.mockResolvedValue({ planType: "STANDARD", tossBillingKey: "bk", nextBillingAt: new Date("2026-11-01T00:00:00.000Z") });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await run();
    warn.mockRestore();
    expect(out.results[0].status).toBe("skipped_stale");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
