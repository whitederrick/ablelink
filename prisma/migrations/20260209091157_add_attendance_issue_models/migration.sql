-- CreateEnum
CREATE TYPE "AttendanceIssueStatus" AS ENUM ('OPEN', 'REQUESTED', 'REPLIED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "AttendanceIssueType" AS ENUM ('MISSING_CLOCK_IN', 'MISSING_CLOCK_OUT', 'OUT_OF_RANGE', 'TIME_ANOMALY');

-- CreateEnum
CREATE TYPE "AttendanceIssueEventType" AS ENUM ('ISSUE_CREATED', 'REASON_REQUESTED', 'REPLIED', 'FIX_REQUESTED', 'RESOLVED', 'MEMO_UPDATED');

-- CreateEnum
CREATE TYPE "AttendanceIssueActorRole" AS ENUM ('ADMIN', 'COACH');

-- CreateTable
CREATE TABLE "attendance_issues" (
    "id" BIGSERIAL NOT NULL,
    "daily_attendance_id" BIGINT NOT NULL,
    "status" "AttendanceIssueStatus" NOT NULL DEFAULT 'OPEN',
    "issueTypes" "AttendanceIssueType"[] DEFAULT ARRAY[]::"AttendanceIssueType"[],
    "coach_reason_text" TEXT,
    "admin_memo" TEXT,
    "requested_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_issue_events" (
    "id" BIGSERIAL NOT NULL,
    "issue_id" BIGINT NOT NULL,
    "type" "AttendanceIssueEventType" NOT NULL,
    "actor_role" "AttendanceIssueActorRole" NOT NULL,
    "actor_user_id" BIGINT,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_issue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_issues_daily_attendance_id_key" ON "attendance_issues"("daily_attendance_id");

-- CreateIndex
CREATE INDEX "attendance_issues_status_updated_at_idx" ON "attendance_issues"("status", "updated_at");

-- CreateIndex
CREATE INDEX "attendance_issue_events_issue_id_created_at_idx" ON "attendance_issue_events"("issue_id", "created_at");

-- AddForeignKey
ALTER TABLE "attendance_issues" ADD CONSTRAINT "attendance_issues_daily_attendance_id_fkey" FOREIGN KEY ("daily_attendance_id") REFERENCES "daily_attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "attendance_issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_issue_events" ADD CONSTRAINT "attendance_issue_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
