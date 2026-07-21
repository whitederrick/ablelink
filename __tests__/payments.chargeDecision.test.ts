import { describe, it, expect } from "vitest";
import { decideChargeOutcome, isTwinCronAdvance } from "@/lib/payments/chargeDecision";

const GRACE = 3;

// 실제 라우트가 쓰는 판정과 동일한 isPaid
const isPaid = (p: string | null | undefined) => !!p && ["STARTER", "STANDARD", "PRO"].includes(p);

describe("decideChargeOutcome — 성공 계열", () => {
  it("success → 다음 결제일 진행, 키 유지", () => {
    expect(decideChargeOutcome({ kind: "success" }, 0, GRACE)).toEqual({
      action: "advance",
      wipeBillingKey: false,
    });
  });
  it("already_processed(멱등 재시도) → 성공 간주, 강등 금지", () => {
    expect(decideChargeOutcome({ kind: "already_processed" }, 5, GRACE)).toEqual({
      action: "advance",
      wipeBillingKey: false,
    });
  });
});

describe("decideChargeOutcome — 예외(타임아웃/네트워크)는 불확정 → 절대 강등·키삭제 안 함", () => {
  it("★P2 회귀: 타임아웃 + 유예 초과여도 강등/키삭제 금지, 재시도", () => {
    expect(decideChargeOutcome({ kind: "exception", isTimeout: true }, 5, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
  });
  it("네트워크 예외 + 유예 초과여도 재시도(빌링키 보존 → 멱등 복구 경로 유지)", () => {
    expect(decideChargeOutcome({ kind: "exception", isTimeout: false }, 10, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
  });
  it("유예 이내 예외도 재시도", () => {
    expect(decideChargeOutcome({ kind: "exception", isTimeout: true }, 0, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
  });
});

describe("decideChargeOutcome — HTTP 오류(Toss 응답 확정)", () => {
  it("5xx + 유예 이내 → 재시도", () => {
    expect(decideChargeOutcome({ kind: "http_error", status: 500, parsed: true }, 1, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
  });
  it("429 + 유예 이내 → 재시도", () => {
    expect(decideChargeOutcome({ kind: "http_error", status: 429, parsed: false }, 2, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
  });
  it("5xx + 유예 초과 → 강등 + 키삭제", () => {
    expect(decideChargeOutcome({ kind: "http_error", status: 503, parsed: true }, 3, GRACE)).toEqual({
      action: "downgrade",
      wipeBillingKey: true,
    });
  });
  it("카드 거절(파싱된 4xx, code 있음) → 유예 이내여도 즉시 강등 + 키삭제(확정 실패)", () => {
    expect(decideChargeOutcome({ kind: "http_error", status: 400, parsed: true }, 0, GRACE)).toEqual({
      action: "downgrade",
      wipeBillingKey: true,
    });
  });
  it("★재감사 회귀: 비-JSON/빈 본문 4xx(프록시·WAF) → 확정 실패 아님, 재시도(키 보존)", () => {
    expect(decideChargeOutcome({ kind: "http_error", status: 403, parsed: false }, 5, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
    // 408 request-timeout 등도 동일
    expect(decideChargeOutcome({ kind: "http_error", status: 408, parsed: false }, 10, GRACE)).toEqual({
      action: "retry",
      wipeBillingKey: false,
    });
  });
});

describe("isTwinCronAdvance — 결제 후 count=0 경합 원인 판별(P2)", () => {
  const expected = new Date("2026-08-15T01:00:00Z");

  it("쌍둥이 cron: 같은 planType·같은 결제일로 전진 → benign(true)", () => {
    expect(isTwinCronAdvance({
      freshPlanType: "STANDARD",
      freshNextBillingAt: new Date("2026-08-15T01:00:00Z"),
      expectedNextBillingAt: expected,
      originalPlanType: "STANDARD",
      isPaid,
    })).toBe(true);
  });

  it("★P2 회귀: 해지 경합(FREE 전환) → 유해(false) → 자동취소 합류", () => {
    expect(isTwinCronAdvance({
      freshPlanType: "FREE",
      freshNextBillingAt: null,
      expectedNextBillingAt: expected,
      originalPlanType: "STANDARD",
      isPaid,
    })).toBe(false);
  });

  it("★P2 회귀: 플랜변경/재구독 경합 — 유료 유지·nextBillingAt!=null 이나 결제일이 다름 → 유해(false)", () => {
    // 예전 판정('유료 && nextBillingAt!=null')이면 true로 오판했던 케이스.
    expect(isTwinCronAdvance({
      freshPlanType: "PRO",
      freshNextBillingAt: new Date("2026-09-01T01:00:00Z"), // 재구독이 다른 결제일로 갱신
      expectedNextBillingAt: expected,
      originalPlanType: "STANDARD",
      isPaid,
    })).toBe(false);
  });

  it("★P2 회귀: 같은 결제일이라도 planType이 바뀌면(다운/업그레이드) 유해(false)", () => {
    expect(isTwinCronAdvance({
      freshPlanType: "PRO",
      freshNextBillingAt: new Date("2026-08-15T01:00:00Z"),
      expectedNextBillingAt: expected,
      originalPlanType: "STANDARD",
      isPaid,
    })).toBe(false);
  });

  it("조회 실패(planType null) → 유해(false)", () => {
    expect(isTwinCronAdvance({
      freshPlanType: null,
      freshNextBillingAt: null,
      expectedNextBillingAt: expected,
      originalPlanType: "STANDARD",
      isPaid,
    })).toBe(false);
  });
});
