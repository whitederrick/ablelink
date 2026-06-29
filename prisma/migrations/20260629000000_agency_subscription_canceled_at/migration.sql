-- 구독 해지 시점 기록(재구독 시 NULL로 초기화)
ALTER TABLE "agencies" ADD COLUMN "subscription_canceled_at" TIMESTAMP(6);
