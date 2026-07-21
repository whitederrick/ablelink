-- 환불 종류 판별자(2026-07-21 감사 P3: 사이클링 남용 모니터링 오탐) — 순수 ADD COLUMN, 기존 행 무영향.
-- refund_kind: 이 환불이 어떤 경로에서 발생했는지 구분(CANCEL=구독 해지, PLAN_CHANGE=플랜 변경,
--  ADMIN_TERMINATION=운영자 강등, CONFLICT=cron 해지 경합 자동취소). 사이클링 남용(반복 구독-해지)
--  경보가 해지(CANCEL)만 집계하도록 해, 정상적인 플랜 변경·운영자 강등 환불의 오탐을 제거한다.

ALTER TABLE "subscription_payments" ADD COLUMN "refund_kind" TEXT;
