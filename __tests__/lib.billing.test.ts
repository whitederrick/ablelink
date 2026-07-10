import { describe, it, expect } from "vitest";
import { advanceBilling, buildBillingOrderId } from "@/lib/billing";

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 그물: advanceBilling 말일 오버플로우(#5).
// setMonth/setFullYear는 원일이 대상 달에 없으면 넘쳐서 한 달을 통째로 건너뛴다.
// 말일(29-31) 가입자가 특정 달을 청구받지 못하는 매출 누수를 고정한다.
// (로컬/UTC 어디서 돌든 new Date(y,m,d) 로컬 생성 ↔ advanceBilling 로컬 메서드로 프레임 일치)
// ─────────────────────────────────────────────────────────────────────────────

/** 결과를 YYYY-MM-DD(로컬)로 */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("advanceBilling — MONTHLY 말일 오버플로우 방지(#5)", () => {
  it("1/31 → 2/28 (2026 비윤년): 2월을 건너뛰지 않음", () => {
    expect(ymd(advanceBilling(new Date(2026, 0, 31), "MONTHLY"))).toBe("2026-02-28");
  });
  it("1/31 → 2/29 (2028 윤년)", () => {
    expect(ymd(advanceBilling(new Date(2028, 0, 31), "MONTHLY"))).toBe("2028-02-29");
  });
  it("5/31 → 6/30 (30일 달로 clamp)", () => {
    expect(ymd(advanceBilling(new Date(2026, 4, 31), "MONTHLY"))).toBe("2026-06-30");
  });
  it("3/31 → 4/30", () => {
    expect(ymd(advanceBilling(new Date(2026, 2, 31), "MONTHLY"))).toBe("2026-04-30");
  });
  it("12/31 → 다음해 1/31 (연말 경계·원일 보존)", () => {
    expect(ymd(advanceBilling(new Date(2026, 11, 31), "MONTHLY"))).toBe("2027-01-31");
  });
  it("일반일 15일은 그대로 다음 달 15일", () => {
    expect(ymd(advanceBilling(new Date(2026, 5, 15), "MONTHLY"))).toBe("2026-07-15");
  });
  it("2/28 → 3/28 (말일 아닌 28일은 clamp 없이 원일 보존)", () => {
    expect(ymd(advanceBilling(new Date(2026, 1, 28), "MONTHLY"))).toBe("2026-03-28");
  });
});

describe("buildBillingOrderId — 같은 달 플랜변경=새 결제, 같은 plan 재시도=멱등(#4)", () => {
  // 2026-07-20 KST (UTC 11:20 → +9h = 20:20 KST, 같은 날)
  const t1 = new Date("2026-07-20T11:20:00Z");
  const t2 = new Date("2026-07-25T02:00:00Z"); // 같은 달 다른 날

  it("같은 달 다른 plan → 다른 orderId (무료 상향 차단)", () => {
    expect(buildBillingOrderId(5, t1, "STARTER")).not.toBe(buildBillingOrderId(5, t1, "PRO"));
  });
  it("같은 달·같은 plan → 동일 orderId (멱등 재시도 보존)", () => {
    expect(buildBillingOrderId(5, t1, "PRO")).toBe(buildBillingOrderId(5, t2, "PRO"));
  });
  it("KST 결제월·plan 포함 포맷", () => {
    expect(buildBillingOrderId(5, t1, "PRO")).toBe("ablelink_5_202607_PRO");
  });
  it("UTC 자정 직전이라도 KST 기준 월로 산출(경계)", () => {
    // 2026-06-30T20:00Z → +9h = 2026-07-01 05:00 KST → 202607
    expect(buildBillingOrderId(5, new Date("2026-06-30T20:00:00Z"), "PRO")).toBe("ablelink_5_202607_PRO");
  });
});

describe("advanceBilling — ANNUAL", () => {
  it("2024-02-29(윤년) → 2025-02-28 clamp", () => {
    expect(ymd(advanceBilling(new Date(2024, 1, 29), "ANNUAL"))).toBe("2025-02-28");
  });
  it("일반일은 +1년 동일 날짜", () => {
    expect(ymd(advanceBilling(new Date(2026, 6, 15), "ANNUAL"))).toBe("2027-07-15");
  });
});
