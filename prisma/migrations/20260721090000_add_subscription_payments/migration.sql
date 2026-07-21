-- 구독 결제 이력(2026-07-21) — 해지 시 잔여일 일할 부분환불(토스 부분취소)용 paymentKey·주기 보존.
-- 순수 추가(CREATE만), 기존 테이블 무변경.

-- CreateTable
CREATE TABLE "subscription_payments" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payment_key" TEXT,
    "plan_type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "cycle" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "refunded_amount" INTEGER NOT NULL DEFAULT 0,
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_payments_order_id_key" ON "subscription_payments"("order_id");

-- CreateIndex
CREATE INDEX "subscription_payments_agency_id_created_at_idx" ON "subscription_payments"("agency_id", "created_at");

-- AddForeignKey
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
