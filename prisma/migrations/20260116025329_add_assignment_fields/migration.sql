-- CreateEnum
CREATE TYPE "BasePointStage" AS ENUM ('AGENCY_CONFIRMED', 'COACH_FINAL');

-- CreateEnum
CREATE TYPE "BasePointSourceType" AS ENUM ('ADDRESS', 'DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "SubmissionRequestStatus" AS ENUM ('REQUESTED', 'SUBMITTED', 'REVIEWED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('ADMIN_USER', 'USER', 'SITE_CONTACT');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('SITE', 'ASSIGNMENT', 'ATTENDANCE', 'TRAINEE', 'SUBMISSION', 'BASEPOINT', 'PAYROLL');

-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('MONTHLY', 'DAILY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "AssignStatus" ADD VALUE 'CONFIRMED';
ALTER TYPE "AssignStatus" ADD VALUE 'REJECTED';
ALTER TYPE "AssignStatus" ADD VALUE 'DROPPED';

-- AlterTable
ALTER TABLE "daily_attendances" ADD COLUMN     "assignment_id" BIGINT,
ADD COLUMN     "base_point_id" BIGINT,
ADD COLUMN     "end_distance_m" DOUBLE PRECISION,
ADD COLUMN     "range_m" INTEGER,
ADD COLUMN     "start_distance_m" DOUBLE PRECISION,
ADD COLUMN     "within_range" BOOLEAN;

-- AlterTable
ALTER TABLE "site_assignments" ADD COLUMN     "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "assigned_by_admin_id" BIGINT,
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "dropped_at" TIMESTAMP(3),
ADD COLUMN     "ended_at" TIMESTAMP(3),
ADD COLUMN     "rejected_at" TIMESTAMP(3),
ADD COLUMN     "status_reason" TEXT;

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "current_base_point_id" BIGINT;

-- CreateTable
CREATE TABLE "site_base_points" (
    "id" BIGSERIAL NOT NULL,
    "site_id" BIGINT NOT NULL,
    "lat" DECIMAL(65,30) NOT NULL,
    "lon" DECIMAL(65,30) NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "source_type" "BasePointSourceType" NOT NULL,
    "stage" "BasePointStage" NOT NULL,
    "authority" "ApprovalAuthorityType" NOT NULL,
    "confirmed_by_user_id" BIGINT,
    "confirmed_by_admin_id" BIGINT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memo" TEXT,
    "correction_reason" TEXT,
    "prev_base_point_id" BIGINT,

    CONSTRAINT "site_base_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_contacts" (
    "id" BIGSERIAL NOT NULL,
    "site_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone_number" TEXT,
    "role" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_requests" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "assignment_id" BIGINT NOT NULL,
    "requested_by_admin_id" BIGINT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_date" TIMESTAMP(3),
    "status" "SubmissionRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "memo" TEXT,

    CONSTRAINT "submission_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" BIGSERIAL NOT NULL,
    "request_id" BIGINT NOT NULL,
    "submitted_by_user_id" BIGINT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_url" TEXT,
    "file_name" TEXT,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" BIGINT,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" BIGINT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_contracts" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "pay_type" "PayType" NOT NULL,
    "base_amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "year_month" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" BIGSERIAL NOT NULL,
    "run_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "gross_pay" DECIMAL(65,30) NOT NULL,
    "total_deduction" DECIMAL(65,30) NOT NULL,
    "net_pay" DECIMAL(65,30) NOT NULL,
    "worked_days" INTEGER,
    "worked_minutes" INTEGER,
    "breakdown" JSONB,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_base_points_site_id_stage_idx" ON "site_base_points"("site_id", "stage");

-- CreateIndex
CREATE INDEX "site_base_points_confirmed_by_user_id_idx" ON "site_base_points"("confirmed_by_user_id");

-- CreateIndex
CREATE INDEX "site_base_points_confirmed_by_admin_id_idx" ON "site_base_points"("confirmed_by_admin_id");

-- CreateIndex
CREATE INDEX "site_contacts_site_id_is_active_idx" ON "site_contacts"("site_id", "is_active");

-- CreateIndex
CREATE INDEX "submission_requests_assignment_id_status_idx" ON "submission_requests"("assignment_id", "status");

-- CreateIndex
CREATE INDEX "submission_requests_agency_id_status_idx" ON "submission_requests"("agency_id", "status");

-- CreateIndex
CREATE INDEX "submissions_request_id_submitted_at_idx" ON "submissions"("request_id", "submitted_at");

-- CreateIndex
CREATE INDEX "submissions_submitted_by_user_id_submitted_at_idx" ON "submissions"("submitted_by_user_id", "submitted_at");

-- CreateIndex
CREATE INDEX "audit_events_agency_id_entity_type_entity_id_idx" ON "audit_events"("agency_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_type_actor_id_idx" ON "audit_events"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "pay_contracts_agency_id_user_id_effective_from_idx" ON "pay_contracts"("agency_id", "user_id", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_agency_id_year_month_key" ON "payroll_runs"("agency_id", "year_month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_items_run_id_user_id_key" ON "payroll_items"("run_id", "user_id");

-- CreateIndex
CREATE INDEX "daily_attendances_assignment_id_idx" ON "daily_attendances"("assignment_id");

-- CreateIndex
CREATE INDEX "daily_attendances_base_point_id_idx" ON "daily_attendances"("base_point_id");

-- CreateIndex
CREATE INDEX "site_assignments_site_id_status_idx" ON "site_assignments"("site_id", "status");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_current_base_point_id_fkey" FOREIGN KEY ("current_base_point_id") REFERENCES "site_base_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_assigned_by_admin_id_fkey" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_base_point_id_fkey" FOREIGN KEY ("base_point_id") REFERENCES "site_base_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_confirmed_by_admin_id_fkey" FOREIGN KEY ("confirmed_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_base_points" ADD CONSTRAINT "site_base_points_prev_base_point_id_fkey" FOREIGN KEY ("prev_base_point_id") REFERENCES "site_base_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_contacts" ADD CONSTRAINT "site_contacts_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_requests" ADD CONSTRAINT "submission_requests_requested_by_admin_id_fkey" FOREIGN KEY ("requested_by_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "submission_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_contracts" ADD CONSTRAINT "pay_contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_contracts" ADD CONSTRAINT "pay_contracts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
