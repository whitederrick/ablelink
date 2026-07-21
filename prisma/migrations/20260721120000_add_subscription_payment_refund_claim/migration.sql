-- 환불 claim(선점)·대체 표기 컬럼(2026-07-21 감사 P1/P2 대응) — 순수 ADD COLUMN, 기존 행 무영향.
-- refund_pending_amount/refund_claimed_at: 토스 호출 전 환불액 고정(재시도 멱등 본문 불변·15일 만료 후 이중환불 차단)
-- superseded_at: 플랜 변경·강등으로 활성 주기 대표성을 잃은 결제 표기(환불 대상 선정 제외)

ALTER TABLE "subscription_payments" ADD COLUMN "refund_pending_amount" INTEGER;
ALTER TABLE "subscription_payments" ADD COLUMN "refund_claimed_at" TIMESTAMP(3);
ALTER TABLE "subscription_payments" ADD COLUMN "superseded_at" TIMESTAMP(3);
