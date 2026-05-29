-- CreateTable: AI API 호출 로그
CREATE TABLE "api_call_logs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "user_id" BIGINT,
    "service" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: 시스템 공지
CREATE TABLE "system_announcements" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'INFO',
    "admin_id" BIGINT,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_announcements_pkey" PRIMARY KEY ("id")
);

-- AlterTable: agencies.is_active (존재하지 않는 경우에만 추가)
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "api_call_logs_agency_id_service_created_at_idx" ON "api_call_logs"("agency_id", "service", "created_at");
CREATE INDEX "api_call_logs_created_at_idx" ON "api_call_logs"("created_at");
CREATE INDEX "system_announcements_created_at_idx" ON "system_announcements"("created_at");

-- AddForeignKey
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "api_call_logs" ADD CONSTRAINT "api_call_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "system_announcements" ADD CONSTRAINT "system_announcements_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
