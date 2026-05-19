-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ATTENDANCE_SHEET', 'TRAINING_DAILY_LOG', 'TRAINEE_COMPREHENSIVE_EVAL', 'POST_EMPLOY_ADAPT_LOG', 'ADAPTATION_COMPREHENSIVE_EVAL', 'CHECKLIST');

-- CreateEnum
CREATE TYPE "DocumentStage" AS ENUM ('PRE', 'FINAL');

-- CreateEnum
CREATE TYPE "DocumentRunStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "document_runs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "assignment_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "coach_user_id" BIGINT NOT NULL,
    "doc_type" "DocumentType" NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "open_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "DocumentRunStatus" NOT NULL DEFAULT 'OPEN',
    "current_version_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "stage" "DocumentStage" NOT NULL,
    "pdf_url" TEXT NOT NULL,
    "pdf_file_name" TEXT,
    "source_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" BIGINT,
    "created_by_admin_id" BIGINT,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_submission_logs" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "version_id" BIGINT NOT NULL,
    "stage" "DocumentStage" NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by_user_id" BIGINT,
    "submitted_by_admin_id" BIGINT,
    "sent_to_email" TEXT,
    "email_sent_at" TIMESTAMP(3),
    "email_status" TEXT,
    "email_payload" JSONB,

    CONSTRAINT "document_submission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_runs_agency_id_doc_type_period_start_idx" ON "document_runs"("agency_id", "doc_type", "period_start");

-- CreateIndex
CREATE INDEX "document_runs_assignment_id_doc_type_idx" ON "document_runs"("assignment_id", "doc_type");

-- CreateIndex
CREATE UNIQUE INDEX "document_runs_assignment_id_doc_type_period_start_key" ON "document_runs"("assignment_id", "doc_type", "period_start");

-- CreateIndex
CREATE INDEX "document_versions_run_id_stage_created_at_idx" ON "document_versions"("run_id", "stage", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_run_id_version_no_key" ON "document_versions"("run_id", "version_no");

-- CreateIndex
CREATE INDEX "document_submission_logs_run_id_stage_submitted_at_idx" ON "document_submission_logs"("run_id", "stage", "submitted_at");

-- CreateIndex
CREATE INDEX "document_submission_logs_version_id_idx" ON "document_submission_logs"("version_id");

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_coach_user_id_fkey" FOREIGN KEY ("coach_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_runs" ADD CONSTRAINT "document_runs_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "document_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "document_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_submission_logs" ADD CONSTRAINT "document_submission_logs_submitted_by_admin_id_fkey" FOREIGN KEY ("submitted_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
