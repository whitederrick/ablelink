-- 운영자 건바이건 결제 딜 설정 (2026-06-06)
-- 할인 정책을 코드에 박지 않고, 운영자가 에이전시별로 결제 주기·협상가를 설정한다. 추가형(무손실).
ALTER TABLE "agencies" ADD COLUMN "billing_cycle" TEXT NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "agencies" ADD COLUMN "custom_amount" INTEGER;
ALTER TABLE "agencies" ADD COLUMN "billing_note" TEXT;
