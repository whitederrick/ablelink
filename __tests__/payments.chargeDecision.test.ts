import { describe, it, expect } from "vitest";
import { decideChargeOutcome } from "@/lib/payments/chargeDecision";

const GRACE = 3;

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
