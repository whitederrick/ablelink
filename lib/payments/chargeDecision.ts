// lib/payments/chargeDecision.ts
// 정기결제(cron) 시도 결과 → 다음 행동 결정. 순수 로직(단위 테스트 가능).
//
// 회귀 방지의 핵심:
//  벤더(Toss) fetch 타임아웃/네트워크 예외는 "결제가 됐는지 안 됐는지 알 수 없는(불확정)" 상태다.
//  Toss 빌링 POST는 카드 승인을 동기 처리하므로, 우리가 10초로 abort해도 서버에선 승인됐을 수 있다.
//  이때 강등(FREE)하고 빌링키를 지우면 → 고객은 청구됐는데 FREE로 떨어지고, 멱등 재시도(ALREADY_PROCESSED
//  자동복구)에 필요한 빌링키마저 사라져 회복 불가. 따라서 예외는 절대 강등/키삭제하지 않고 재시도한다.
//  '확정 실패'는 Toss가 4xx 응답을 준 경우(카드 거절 등)뿐이며 그때만 강등한다.

export type ChargeOutcome =
  | { kind: "success" } // res.ok
  | { kind: "already_processed" } // 중복 orderId=이미 결제됨(직전 성공 후 크래시 재시도)
  | { kind: "http_error"; status: number } // Toss가 응답은 줬으나 실패(4xx/5xx)
  | { kind: "exception"; isTimeout: boolean }; // fetch 예외(타임아웃/네트워크) — 결과 불확정

export interface ChargeDecision {
  /** advance=다음 결제일로 진행 · retry=nextBillingAt 유지하고 다음 cron 재시도 · downgrade=FREE 강등 */
  action: "advance" | "retry" | "downgrade";
  /** 빌링키 삭제 여부(강등 시 카드 재등록 유도). 불확정 예외에선 절대 false */
  wipeBillingKey: boolean;
}

export function decideChargeOutcome(
  outcome: ChargeOutcome,
  daysOverdue: number,
  graceDays: number,
): ChargeDecision {
  switch (outcome.kind) {
    case "success":
    case "already_processed":
      return { action: "advance", wipeBillingKey: false };

    case "exception":
      // 타임아웃/네트워크 = 결과 불확정(결제됐을 수도). 강등·키삭제 금지 → 다음 cron 재시도.
      return { action: "retry", wipeBillingKey: false };

    case "http_error": {
      // 5xx·429 = 일시 오류 → 유예 내 재시도. 그 외(카드 거절 등)·유예 초과 → 확정 강등.
      const transient = outcome.status >= 500 || outcome.status === 429;
      if (transient && daysOverdue < graceDays) {
        return { action: "retry", wipeBillingKey: false };
      }
      return { action: "downgrade", wipeBillingKey: true };
    }
  }
}
