/*
  Warnings:

  - You are about to drop the column `field_training_end` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `field_training_start` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `is_extra_time` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `no_field_training` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `no_pre_training` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `pre_training_end` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `pre_training_start` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `work_type` on the `sites` table. All the data in the column will be lost.
  - The `status` column on the `trainee_placements` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `status` column on the `trainees` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[assignment_id,work_date]` on the table `daily_attendances` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[place_id]` on the table `sites` will be added. If there are existing duplicate values, this will fail.
  - Made the column `assignment_id` on table `daily_attendances` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ServiceStep" AS ENUM ('PRE_TRAINING', 'FIELD_TRAINING', 'ADAPTATION');

-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('APP_GPS', 'EXTERNAL', 'NONE');

-- CreateEnum
CREATE TYPE "TraineePlacementStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DROPOUT', 'PAUSED');

-- AlterEnum
ALTER TYPE "SiteSourceType" ADD VALUE 'COACH_ENTRY';

-- DropForeignKey
ALTER TABLE "attendance_issues" DROP CONSTRAINT "attendance_issues_daily_attendance_id_fkey";

-- DropForeignKey
ALTER TABLE "daily_attendances" DROP CONSTRAINT "daily_attendances_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "trainee_logs" DROP CONSTRAINT "trainee_logs_attendance_id_fkey";

-- DropIndex
DROP INDEX "daily_attendances_assignment_id_idx";

-- DropIndex
DROP INDEX "daily_attendances_user_id_work_date_key";

-- AlterTable
ALTER TABLE "AdminUser" ADD COLUMN     "agency_id" BIGINT;

-- AlterTable
ALTER TABLE "daily_attendances" ALTER COLUMN "assignment_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "site_assignments" ADD COLUMN     "agency_id" BIGINT,
ADD COLUMN     "attendance_mode" "AttendanceMode" NOT NULL DEFAULT 'APP_GPS',
ADD COLUMN     "is_extra_time" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "service_step" "ServiceStep" NOT NULL DEFAULT 'FIELD_TRAINING',
ADD COLUMN     "step_end" TIMESTAMP(3),
ADD COLUMN     "step_start" TIMESTAMP(3),
ADD COLUMN     "work_type" TEXT;

-- AlterTable
ALTER TABLE "sites" DROP COLUMN "field_training_end",
DROP COLUMN "field_training_start",
DROP COLUMN "is_extra_time",
DROP COLUMN "no_field_training",
DROP COLUMN "no_pre_training",
DROP COLUMN "pre_training_end",
DROP COLUMN "pre_training_start",
DROP COLUMN "work_type",
ADD COLUMN     "is_verified" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "merged_to_site_id" BIGINT,
ADD COLUMN     "normalized_address_key" TEXT,
ADD COLUMN     "place_id" TEXT;

-- AlterTable
ALTER TABLE "trainee_placements" DROP COLUMN "status",
ADD COLUMN     "status" "TraineePlacementStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "trainees" DROP COLUMN "status",
ADD COLUMN     "status" "TraineeStatus" NOT NULL DEFAULT 'TRAINING';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "plan_type" "PlanType" NOT NULL DEFAULT 'FREE';

-- CreateIndex
CREATE INDEX "AdminUser_agency_id_idx" ON "AdminUser"("agency_id");

-- CreateIndex
CREATE INDEX "daily_attendances_user_id_work_date_idx" ON "daily_attendances"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "daily_attendances_site_id_work_date_idx" ON "daily_attendances"("site_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attendances_assignment_id_work_date_key" ON "daily_attendances"("assignment_id", "work_date");

-- CreateIndex
CREATE INDEX "site_assignments_agency_id_status_idx" ON "site_assignments"("agency_id", "status");

-- CreateIndex
CREATE INDEX "site_assignments_service_step_attendance_mode_idx" ON "site_assignments"("service_step", "attendance_mode");

-- CreateIndex
CREATE UNIQUE INDEX "sites_place_id_key" ON "sites"("place_id");

-- CreateIndex
CREATE INDEX "sites_agency_id_is_active_idx" ON "sites"("agency_id", "is_active");

-- CreateIndex
CREATE INDEX "sites_siteSourceType_is_verified_idx" ON "sites"("siteSourceType", "is_verified");

-- CreateIndex
CREATE INDEX "sites_normalized_address_key_idx" ON "sites"("normalized_address_key");

-- CreateIndex
CREATE INDEX "trainee_logs_trainee_id_idx" ON "trainee_logs"("trainee_id");

-- CreateIndex
CREATE INDEX "trainee_logs_writer_id_idx" ON "trainee_logs"("writer_id");

-- CreateIndex
CREATE INDEX "trainee_placements_site_id_status_idx" ON "trainee_placements"("site_id", "status");

-- CreateIndex
CREATE INDEX "trainee_placements_trainee_id_status_idx" ON "trainee_placements"("trainee_id", "status");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_merged_to_site_id_fkey" FOREIGN KEY ("merged_to_site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "daily_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issues" ADD CONSTRAINT "attendance_issues_daily_attendance_id_fkey" FOREIGN KEY ("daily_attendance_id") REFERENCES "daily_attendances"("id") ON DELETE CASCADE ON UPDATE CASCADE;
