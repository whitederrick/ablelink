-- AlterTable: daily_attendances에 매니저 최종 확정 필드 추가
ALTER TABLE "daily_attendances"
  ADD COLUMN IF NOT EXISTS "is_manager_final_closed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "manager_final_at" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "manager_final_by" BIGINT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "daily_attendances_is_manager_final_closed_idx"
  ON "daily_attendances"("is_manager_final_closed");
