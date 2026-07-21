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
  // Toss가 응답은 줬으나 실패(4xx/5xx). parsed=Toss 에러 본문(code)이 실제로 파싱됐는가.
  //  parsed=false(비-JSON/빈 본문)면 프록시/WAF발 응답일 수 있어 '확정 실패' 아님(불확정 취급).
  | { kind: "http_error"; status: number; parsed: boolean }
  | { kind: "exception"; isTimeout: boolean }; // fetch 예외(타임아웃/네트워크) — 결과 불확정

export interface ChargeDecision {
  /** advance=다음 결제일로 진행 · retry=nextBillingAt 유지하고 다음 cron 재시도 · downgrade=FREE 강등 */
  action: "advance" | "retry" | "downgrade";
  /** 빌링키 삭제 여부(강등 시 카드 재등록 유도). 불확정 예외에선 절대 false */
  wipeBillingKey: boolean;
}

// 결제 후 agency.updateMany(count=0) 경합의 원인 판별(순수 로직·단위 테스트 가능).
//  count=0 = 스냅샷 이후 이 기관의 nextBillingAt이 바뀜. 두 가지 원인:
//   ① 쌍둥이 cron이 이미 전진(무해) — 동일 스냅샷으로 같은 planType·같은 nextBillingAt으로 갔다.
//   ② 해지/플랜변경 경합(유해) — planType이 FREE로 갔거나(해지) 다른 결제일로 갱신됨(변경/재구독).
//  ①만 참일 때 true. 그 외(②·조회실패)는 false → 방금 청구는 '유령 결제'일 수 있어 자동 전액취소로 합류.
//  (2026-07-21 P2: 예전엔 '유료 && nextBillingAt!=null'만 봐서 ②의 재구독을 무해로 오판 → 이중과금.)
export function isTwinCronAdvance(params: {
  freshPlanType: string | null | undefined;
  freshNextBillingAt: Date | null | undefined;
  expectedNextBillingAt: Date;
  originalPlanType: string;
  isPaid: (p: string | null | undefined) => boolean;
}): boolean {
  const { freshPlanType, freshNextBillingAt, expectedNextBillingAt, originalPlanType, isPaid } = params;
  return isPaid(freshPlanType)
    && freshNextBillingAt != null
    && freshNextBillingAt.getTime() === expectedNextBillingAt.getTime()
    && freshPlanType === originalPlanType;
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
      // 5xx·429 = 일시 오류 → 유예 내 재시도, 초과 시 강등.
      const transient = outcome.status >= 500 || outcome.status === 429;
      if (transient) {
        return daysOverdue < graceDays
          ? { action: "retry", wipeBillingKey: false }
          : { action: "downgrade", wipeBillingKey: true };
      }
      // 4xx(비-transient): Toss 에러 본문(code)이 파싱된 '확정 실패(카드 거절 등)'만 즉시 강등+키삭제.
      //  비-JSON/빈 본문 4xx(프록시/WAF 등)는 결제 도달 여부 불확정 → 재시도(키 보존).
      if (!outcome.parsed) return { action: "retry", wipeBillingKey: false };
      return { action: "downgrade", wipeBillingKey: true };
    }
  }
}
