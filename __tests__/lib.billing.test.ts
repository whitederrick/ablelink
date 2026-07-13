import { describe, it, expect } from "vitest";
import { advanceBilling, buildBillingOrderId, buildSubscribeOrderId, resolveActivationPlan } from "@/lib/billing";
import { isPaidAgencyPlan } from "@/lib/plans";

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

describe("buildBillingOrderId — cron 반복결제(결제일 yyyymmdd·#B 월충돌 방지)", () => {
  const t1 = new Date("2026-07-20T11:20:00Z"); // KST 2026-07-20 20:20

  it("plan 다르면 orderId 다름 (#4)", () => {
    expect(buildBillingOrderId(5, t1, "STARTER")).not.toBe(buildBillingOrderId(5, t1, "PRO"));
  });
  it("결제일 yyyymmdd 포맷", () => {
    expect(buildBillingOrderId(5, t1, "PRO")).toBe("ablelink_5_20260720_PRO");
  });
  it("같은 결제일(안정 nextBillingAt) 재시도 → 동일 orderId (멱등)", () => {
    expect(buildBillingOrderId(5, t1, "PRO")).toBe(buildBillingOrderId(5, new Date("2026-07-20T11:20:00Z"), "PRO"));
  });
  it("★#B: 연속 두 주기(말일 30일 달·UTC 15-24시 창) → 다른 orderId(월충돌 없음)", () => {
    const initial = buildBillingOrderId(5, new Date("2026-04-30T21:00:00Z"), "PRO"); // 20260501
    const recur   = buildBillingOrderId(5, new Date("2026-05-30T21:00:00Z"), "PRO"); // 20260531
    expect(initial).not.toBe(recur);
  });
});

describe("buildSubscribeOrderId — 수동 구독 이벤트 키(4차 회귀 근본수정)", () => {
  it("epoch·plan 포맷(시간 미포함)", () => {
    expect(buildSubscribeOrderId(5, 0, "PRO")).toBe("ablelink_5_e0_PRO");
    expect(buildSubscribeOrderId(5, 3, "STARTER")).toBe("ablelink_5_e3_STARTER");
  });
  it("같은 epoch·plan 재시도 → 동일 orderId (자정/월경계 무관 멱등 — 이중청구 방지)", () => {
    // 시간 인자가 없으므로 언제 재시도해도 동일
    expect(buildSubscribeOrderId(5, 0, "PRO")).toBe(buildSubscribeOrderId(5, 0, "PRO"));
  });
  it("해지→재구독(epoch 증가) → 다른 orderId (실결제 — 같은 달이어도 무료사이클 없음)", () => {
    expect(buildSubscribeOrderId(5, 0, "PRO")).not.toBe(buildSubscribeOrderId(5, 1, "PRO"));
  });
  it("plan 변경 → 다른 orderId (#4)", () => {
    expect(buildSubscribeOrderId(5, 0, "STARTER")).not.toBe(buildSubscribeOrderId(5, 0, "PRO"));
  });
  it("plan 왕복 A→B→A은 활성화마다 epoch 소비로 3개 모두 다른 orderId (무료 재사용 차단·5차)", () => {
    // 라우트가 성공 활성화마다 billingEpoch를 +1 → PRO(e0)·STARTER(e1)·PRO(e2)
    const ids = [
      buildSubscribeOrderId(5, 0, "PRO"),
      buildSubscribeOrderId(5, 1, "STARTER"),
      buildSubscribeOrderId(5, 2, "PRO"),
    ];
    expect(new Set(ids).size).toBe(3); // e2_PRO ≠ e0_PRO → 되돌아온 PRO도 실결제
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

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 그물: resolveActivationPlan — #2 권한상승 차단.
// 협상가(customAmount>0) 설정 기관은 매니저 요청 등급을 무시하고 운영자 저장 등급으로 고정.
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveActivationPlan — 협상가 설정 시 운영자 등급 고정(#2)", () => {
  it("협상가 있음 + 매니저가 상위등급(PRO) 요청 → 운영자 등급(STARTER)으로 고정", () => {
    expect(resolveActivationPlan("PRO", "STARTER", 30000)).toBe("STARTER");
  });
  it("협상가 있음 + 요청=저장 동일 → 그대로", () => {
    expect(resolveActivationPlan("STANDARD", "STANDARD", 50000)).toBe("STANDARD");
  });
  it("협상가 없음(null) → 매니저 요청 등급 그대로(표준가 결제)", () => {
    expect(resolveActivationPlan("PRO", "FREE", null)).toBe("PRO");
  });
  it("협상가 0(미설정 취급) → 요청 등급 그대로", () => {
    expect(resolveActivationPlan("STANDARD", "STARTER", 0)).toBe("STANDARD");
  });
  it("협상가 음수(방어) → 요청 등급 그대로", () => {
    expect(resolveActivationPlan("PRO", "STARTER", -1)).toBe("PRO");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 테스트 그물: #2 백스톱 불변식(10차) — 결제 활성화 등급은 반드시 유료.
//  해지·강등으로 운영자 저장등급이 FREE가 됐는데 협상가(customAmount)가 남으면 resolveActivationPlan이
//  FREE를 반환 → billing 라우트가 isPaidAgencyPlan로 400 거부(무결제-FREE 방지). 정상 재구독은 해지 시
//  customAmount가 클리어돼 요청 유료등급으로 통과한다.
// ─────────────────────────────────────────────────────────────────────────────
describe("결제 활성화 백스톱 — 유료 등급만 활성화(10차#2)", () => {
  it("협상가 잔존 + 저장등급 FREE → 확정등급 FREE = 유료 아님 → 결제 거부 대상", () => {
    const eff = resolveActivationPlan("PRO", "FREE", 30000);
    expect(eff).toBe("FREE");
    expect(isPaidAgencyPlan(eff)).toBe(false);
  });
  it("정상 재구독(협상가 클리어=null) → 요청 유료등급으로 통과", () => {
    const eff = resolveActivationPlan("PRO", "FREE", null);
    expect(eff).toBe("PRO");
    expect(isPaidAgencyPlan(eff)).toBe(true);
  });
  it("정상 협상가(저장등급 유료) → 유료 통과", () => {
    const eff = resolveActivationPlan("PRO", "STARTER", 30000);
    expect(eff).toBe("STARTER");
    expect(isPaidAgencyPlan(eff)).toBe(true);
  });
});
