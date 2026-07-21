// 구독 중도 해지 잔여일 일할 환불 산식 테스트 (lib/payments/refund.ts)
// 정책: 환불액 = 결제금액 × 잔여일 ÷ 주기 총일수, 해지 당일=이용일(부분일 올림), 공제 없음, 원 미만 버림.
import { describe, it, expect } from "vitest";
import { computeProRataRefund, isWithinFullRefundWindow } from "@/lib/payments/refund";

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

  it("윤년 포함 연 주기(366일) 총일수 정확", () => {
    const r = computeProRataRefund({
      amount: 1200000,
      periodStart: d("2027-06-10T00:00:00Z"),
      periodEnd: d("2028-06-10T00:00:00Z"), // 2028-02-29 포함 = 366일
      at: d("2027-09-18T00:00:00Z"), // 100일 경과
    });
    expect(r.totalDays).toBe(366);
    expect(r.usedDays).toBe(100);
    expect(r.refundAmount).toBe(Math.floor((1200000 * 266) / 366));
  });

  it("30일 주기(4월)", () => {
    const r = computeProRataRefund({
      amount: 99000,
      periodStart: d("2026-04-01T00:00:00Z"),
      periodEnd: d("2026-05-01T00:00:00Z"),
      at: d("2026-04-16T00:00:00Z"),
    });
    expect(r.totalDays).toBe(30);
    expect(r.remainingDays).toBe(15);
    expect(r.refundAmount).toBe(49500);
  });

  it("말일 앵커 clamp 주기 — 1/31→2/28(28일)·2/28→3/31(31일)", () => {
    const feb = computeProRataRefund({
      amount: 99000,
      periodStart: d("2026-01-31T00:00:00Z"),
      periodEnd: d("2026-02-28T00:00:00Z"), // advanceBilling clamp 산출물
      at: d("2026-02-10T00:00:00Z"), // 10일 경과
    });
    expect(feb.totalDays).toBe(28);
    expect(feb.usedDays).toBe(10);
    expect(feb.refundAmount).toBe(Math.floor((99000 * 18) / 28));

    const mar = computeProRataRefund({
      amount: 99000,
      periodStart: d("2026-02-28T00:00:00Z"),
      periodEnd: d("2026-03-31T00:00:00Z"), // 원일(31) 복원 주기
      at: d("2026-03-10T00:00:00Z"),
    });
    expect(mar.totalDays).toBe(31);
    expect(mar.usedDays).toBe(10);
    expect(mar.refundAmount).toBe(Math.floor((99000 * 21) / 31));
  });

  it("협상가 소액 — floor로 0원까지 내려가되 음수 없음", () => {
    const r = computeProRataRefund({
      amount: 20, // 극단 소액(비현실적 협상가)
      periodStart: d("2026-07-01T00:00:00Z"),
      periodEnd: d("2026-08-01T00:00:00Z"),
      at: d("2026-07-31T02:00:00Z"), // 잔여 0~1일 경계
    });
    expect(r.refundAmount).toBeGreaterThanOrEqual(0);
    expect(r.refundAmount).toBeLessThanOrEqual(20);
    const tiny = computeProRataRefund({
      amount: 20,
      periodStart: d("2026-07-01T00:00:00Z"),
      periodEnd: d("2026-08-01T00:00:00Z"),
      at: d("2026-07-31T00:00:00Z"), // 잔여 1일 → 20*1/31 = 0.64 → floor 0
    });
    expect(tiny.refundAmount).toBe(0);
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

describe("isWithinFullRefundWindow — 제3조 7일 청약철회 창", () => {
  const start = d("2026-07-01T00:00:00Z");

  it("결제 직후·7일 정각까지 true", () => {
    expect(isWithinFullRefundWindow(start, start)).toBe(true);
    expect(isWithinFullRefundWindow(start, d("2026-07-04T12:00:00Z"))).toBe(true);
    expect(isWithinFullRefundWindow(start, d("2026-07-08T00:00:00Z"))).toBe(true); // 정확히 7×24h
  });

  it("7일 경과·시작 전은 false", () => {
    expect(isWithinFullRefundWindow(start, d("2026-07-08T00:00:01Z"))).toBe(false);
    expect(isWithinFullRefundWindow(start, d("2026-06-30T23:59:59Z"))).toBe(false);
  });
});
