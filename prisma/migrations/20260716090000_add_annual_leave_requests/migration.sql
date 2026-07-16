-- 연차 신청/확인 워크플로(Phase7, 2026-07-16) — 신청 상태 머신 테이블.
-- 순수 추가(CREATE만) — 기존 테이블 무변경. 원장(annual_leave_entries)과 분리, ledger_entry_id로 연결.

-- CreateEnum
CREATE TYPE "LeaveRequestKind" AS ENUM ('WORKER_REQUEST', 'MANAGER_ENTRY_CONFIRM');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CONFIRMED', 'DISPUTED', 'CANCELED');

-- CreateTable
CREATE TABLE "annual_leave_requests" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "kind" "LeaveRequestKind" NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "effective_date" TIMESTAMP(3) NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "response_note" TEXT,
    "ledger_entry_id" BIGINT,
    "created_by_manager_id" BIGINT,
    "resolved_by_manager_id" BIGINT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "annual_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "annual_leave_requests_agency_id_status_created_at_idx" ON "annual_leave_requests"("agency_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "annual_leave_requests_worker_id_status_created_at_idx" ON "annual_leave_requests"("worker_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "annual_leave_requests_ledger_entry_id_idx" ON "annual_leave_requests"("ledger_entry_id");

-- AddForeignKey
ALTER TABLE "annual_leave_requests" ADD CONSTRAINT "annual_leave_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annual_leave_requests" ADD CONSTRAINT "annual_leave_requests_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
