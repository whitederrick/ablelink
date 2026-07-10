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

describe("advanceBilling — anchorDay 원일 복원(#G 회귀)", () => {
  // 저장된 직전 결제일 day를 쓰면 31→28→28…로 영구 고착. 가입 원일(anchorDay)로 복원해야 함.
  it("2/28에서 원일31 → 3/31 복원 (28로 고착 안 됨)", () => {
    expect(ymd(advanceBilling(new Date(2026, 1, 28), "MONTHLY", 31))).toBe("2026-03-31");
  });
  it("4/30에서 원일31 → 5/31 복원", () => {
    expect(ymd(advanceBilling(new Date(2026, 3, 30), "MONTHLY", 31))).toBe("2026-05-31");
  });
  it("2/28에서 원일31 → (다음달) 3/31, 그 다음도 4/30→5/31 유지(연쇄)", () => {
    const mar = advanceBilling(new Date(2026, 1, 28), "MONTHLY", 31); // 3/31
    const apr = advanceBilling(mar, "MONTHLY", 31);                    // 4/30
    const may = advanceBilling(apr, "MONTHLY", 31);                    // 5/31
    expect(ymd(mar)).toBe("2026-03-31");
    expect(ymd(apr)).toBe("2026-04-30");
    expect(ymd(may)).toBe("2026-05-31");
  });
  it("anchorDay 미지정 시 종전 동작(from의 day)", () => {
    expect(ymd(advanceBilling(new Date(2026, 0, 31), "MONTHLY"))).toBe("2026-02-28");
  });
});

describe("buildBillingOrderId — granularity 분리(#4 plan · #B cron 월충돌 · 3차 수동 멱등)", () => {
  const t1 = new Date("2026-07-20T11:20:00Z"); // KST 2026-07-20 20:20
  const t2 = new Date("2026-07-25T02:00:00Z"); // 같은 달 다른 날

  it("plan 다르면 orderId 다름 (무료 상향 차단, #4)", () => {
    expect(buildBillingOrderId(5, t1, "STARTER")).not.toBe(buildBillingOrderId(5, t1, "PRO"));
  });

  // 수동 초기구독(month=기본): 같은 달 재시도는 자정을 넘겨도 동일 orderId → Toss 멱등(이중청구 방지)
  it("month(수동): 같은 달 다른 날 재시도 → 동일 orderId (자정 크로싱 이중청구 방지·3차 회귀 수정)", () => {
    expect(buildBillingOrderId(5, t1, "PRO")).toBe(buildBillingOrderId(5, t2, "PRO"));
  });
  it("month 포맷 yyyymm", () => {
    expect(buildBillingOrderId(5, t1, "PRO")).toBe("ablelink_5_202607_PRO");
  });

  // cron 반복결제(day): 재시도는 같은 결제일→동일, 연속 두 주기는 날짜가 달라 월충돌 없음(bug B)
  it("day(cron): 같은 결제일 재시도 → 동일 orderId (멱등)", () => {
    expect(buildBillingOrderId(5, t1, "PRO", "day")).toBe(buildBillingOrderId(5, new Date("2026-07-20T11:20:00Z"), "PRO", "day"));
  });
  it("day 포맷 yyyymmdd", () => {
    expect(buildBillingOrderId(5, t1, "PRO", "day")).toBe("ablelink_5_20260720_PRO");
  });
  it("★#B: day 기준 연속 두 주기(말일 30일 달·UTC 15-24시 창) → 다른 orderId(월충돌 없음)", () => {
    const initial = buildBillingOrderId(5, new Date("2026-04-30T21:00:00Z"), "PRO", "day"); // 20260501
    const recur   = buildBillingOrderId(5, new Date("2026-05-30T21:00:00Z"), "PRO", "day"); // 20260531
    expect(initial).not.toBe(recur);
  });
  it("★대조: 같은 두 주기를 month로 하면 충돌(202605)—그래서 cron은 day를 쓴다", () => {
    const a = buildBillingOrderId(5, new Date("2026-04-30T21:00:00Z"), "PRO"); // month → 202605
    const b = buildBillingOrderId(5, new Date("2026-05-30T21:00:00Z"), "PRO"); // month → 202605
    expect(a).toBe(b);
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
