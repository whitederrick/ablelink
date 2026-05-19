/*
  Warnings:

  - The values [REPLIED,FIX_REQUESTED] on the enum `AttendanceIssueEventType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AttendanceIssueEventType_new" AS ENUM ('ISSUE_CREATED', 'REASON_REQUESTED', 'REASON_REPLIED', 'SUPPLEMENT_REQUESTED', 'RESOLVED', 'MEMO_UPDATED');
ALTER TABLE "attendance_issue_events" ALTER COLUMN "type" TYPE "AttendanceIssueEventType_new" USING ("type"::text::"AttendanceIssueEventType_new");
ALTER TYPE "AttendanceIssueEventType" RENAME TO "AttendanceIssueEventType_old";
ALTER TYPE "AttendanceIssueEventType_new" RENAME TO "AttendanceIssueEventType";
DROP TYPE "AttendanceIssueEventType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "attendance_issue_events" DROP CONSTRAINT "attendance_issue_events_issue_id_fkey";

-- AlterTable
ALTER TABLE "attendance_issue_events" ADD COLUMN     "actor_admin_id" BIGINT;

-- CreateIndex
CREATE INDEX "attendance_issue_events_actor_user_id_created_at_idx" ON "attendance_issue_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "attendance_issue_events_actor_admin_id_created_at_idx" ON "attendance_issue_events"("actor_admin_id", "created_at");

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "attendance_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_actor_admin_id_fkey" FOREIGN KEY ("actor_admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
