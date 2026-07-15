-- 연차 관리 정식 모듈(2026-07-15) — 연차 원장 테이블(발생/사용/소멸/정산/조정 append-only).
-- 순수 추가(CREATE만) — 기존 테이블 무변경. dedup_key 일반 unique = cron 자동발생 멱등(partial index 아님).

-- CreateEnum
CREATE TYPE "AnnualLeaveKind" AS ENUM ('ACCRUAL_MONTHLY', 'ACCRUAL_ANNUAL', 'USE', 'EXPIRE', 'PAYOUT', 'ADJUST');

-- CreateTable
CREATE TABLE "annual_leave_entries" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "kind" "AnnualLeaveKind" NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "source_label" TEXT,
    "dedup_key" TEXT,
    "memo" TEXT,
    "created_by_manager_id" BIGINT,
    "payroll_item_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "annual_leave_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "annual_leave_entries_dedup_key_key" ON "annual_leave_entries"("dedup_key");

-- CreateIndex
CREATE INDEX "annual_leave_entries_agency_id_worker_id_idx" ON "annual_leave_entries"("agency_id", "worker_id");

-- CreateIndex
CREATE INDEX "annual_leave_entries_worker_id_effective_date_idx" ON "annual_leave_entries"("worker_id", "effective_date");

-- CreateIndex
CREATE INDEX "annual_leave_entries_agency_id_kind_expires_at_idx" ON "annual_leave_entries"("agency_id", "kind", "expires_at");

-- AddForeignKey
ALTER TABLE "annual_leave_entries" ADD CONSTRAINT "annual_leave_entries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_leave_entries" ADD CONSTRAINT "annual_leave_entries_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
