// 구독 중도 해지 잔여일 일할 환불 산식 테스트 (lib/payments/refund.ts)
// 정책: 환불액 = 결제금액 × 잔여일 ÷ 주기 총일수, 해지 당일=이용일(부분일 올림), 공제 없음, 원 미만 버림.
import { describe, it, expect } from "vitest";
import { computeProRataRefund } from "@/lib/payments/refund";

const d = (s: string) => new Date(s);

describe("computeProRataRefund — 월 주기(31일)", () => {
  const periodStart = d("2026-07-01T00:00:00Z");
  const periodEnd = d("2026-08-01T00:00:00Z"); // 31일

  it("10일 사용 후 해지 → 잔여 21일 일할 환불(원 미만 버림)", () => {
    const r = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2026-07-11T00:00:00Z") });
    expect(r.totalDays).toBe(31);
    expect(r.usedDays).toBe(10);
    expect(r.remainingDays).toBe(21);
    expect(r.refundAmount).toBe(Math.floor((99000 * 21) / 31)); // 67064
  });

  it("결제 직후(경과 0) 해지 → 전액 환불", () => {
    const r = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: periodStart });
    expect(r.usedDays).toBe(0);
    expect(r.refundAmount).toBe(99000);
  });

  it("결제 1시간 뒤 해지 → 당일 1일 이용 계산", () => {
    const r = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2026-07-01T01:00:00Z") });
    expect(r.usedDays).toBe(1);
    expect(r.remainingDays).toBe(30);
    expect(r.refundAmount).toBe(Math.floor((99000 * 30) / 31));
  });

  it("부분일은 이용일로 올림(10.5일 경과 → 11일 이용)", () => {
    const r = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2026-07-11T12:00:00Z") });
    expect(r.usedDays).toBe(11);
    expect(r.remainingDays).toBe(20);
  });

  it("주기 종료 시점·이후 해지 → 환불 0", () => {
    expect(computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: periodEnd }).refundAmount).toBe(0);
    expect(computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2026-09-15T00:00:00Z") }).refundAmount).toBe(0);
  });

  it("마지막 날 해지 → 잔여 0일·환불 0", () => {
    const r = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2026-07-31T12:00:00Z") });
    expect(r.usedDays).toBe(31);
    expect(r.refundAmount).toBe(0);
  });
});

describe("computeProRataRefund — 연 주기·엣지", () => {
  it("연 주기(365일) 100일 사용 후 해지", () => {
    const r = computeProRataRefund({
      amount: 990000,
      periodStart: d("2026-01-10T00:00:00Z"),
      periodEnd: d("2027-01-10T00:00:00Z"),
      at: d("2026-04-20T00:00:00Z"), // 100일 경과
    });
    expect(r.totalDays).toBe(365);
    expect(r.usedDays).toBe(100);
    expect(r.refundAmount).toBe(Math.floor((990000 * 265) / 365));
  });

  it("2월 주기(28일)도 총일수 정확", () => {
    const r = computeProRataRefund({
      amount: 49000,
      periodStart: d("2026-02-01T00:00:00Z"),
      periodEnd: d("2026-03-01T00:00:00Z"),
      at: d("2026-02-15T00:00:00Z"),
    });
    expect(r.totalDays).toBe(28);
    expect(r.usedDays).toBe(14);
    expect(r.refundAmount).toBe(Math.floor((49000 * 14) / 28)); // 24500
  });

  it("환불액이 결제금액을 넘지 않고 음수도 아님", () => {
    const periodStart = d("2026-07-01T00:00:00Z");
    const periodEnd = d("2026-08-01T00:00:00Z");
    // 시작 전(비정상 입력) → usedDays 0으로 클램프 = 전액 상한
    const before = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2026-06-01T00:00:00Z") });
    expect(before.refundAmount).toBe(99000);
    // 종료 훨씬 뒤 → 0 하한
    const after = computeProRataRefund({ amount: 99000, periodStart, periodEnd, at: d("2027-01-01T00:00:00Z") });
    expect(after.refundAmount).toBe(0);
  });
});
