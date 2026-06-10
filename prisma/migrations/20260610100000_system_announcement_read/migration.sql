-- 시스템 공지 매니저별 읽음(확인) 상태
CREATE TABLE "system_announcement_reads" (
  "id" BIGSERIAL NOT NULL,
  "announcement_id" BIGINT NOT NULL,
  "manager_id" BIGINT NOT NULL,
  "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_announcement_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "system_announcement_reads_announcement_id_manager_id_key"
  ON "system_announcement_reads"("announcement_id", "manager_id");
CREATE INDEX "system_announcement_reads_manager_id_idx" ON "system_announcement_reads"("manager_id");
