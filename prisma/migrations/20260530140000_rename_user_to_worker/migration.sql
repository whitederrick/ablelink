-- 무손실 리네임: User(직무지도원) 잔재 → Worker
-- 모든 변경은 ALTER ... RENAME 으로 데이터/FK/인덱스를 보존한다.

-- ─── 1. Enum 타입 리네임 ──────────────────────────────────────────────
ALTER TYPE "UserRole"   RENAME TO "WorkerRole";
ALTER TYPE "UserStatus" RENAME TO "WorkerStatus";

-- ─── 2. 테이블 리네임 ─────────────────────────────────────────────────
ALTER TABLE "user_notification_settings" RENAME TO "worker_notification_settings";

-- ─── 3. 컬럼 리네임 ───────────────────────────────────────────────────
ALTER TABLE "workers"                  RENAME COLUMN "user_name"                   TO "worker_name";
ALTER TABLE "sites"                    RENAME COLUMN "basePointProposedByUserId"   TO "basePointProposedByWorkerId";
ALTER TABLE "site_assignments"         RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "daily_attendances"        RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "document_runs"            RENAME COLUMN "worker_user_id"              TO "worker_id";
ALTER TABLE "document_versions"        RENAME COLUMN "created_by_user_id"          TO "created_by_worker_id";
ALTER TABLE "document_submission_logs" RENAME COLUMN "submitted_by_user_id"        TO "submitted_by_worker_id";
ALTER TABLE "site_base_points"         RENAME COLUMN "confirmed_by_user_id"        TO "confirmed_by_worker_id";
ALTER TABLE "submissions"              RENAME COLUMN "submitted_by_user_id"        TO "submitted_by_worker_id";
ALTER TABLE "employment_contracts"     RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "pay_contracts"            RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "payroll_items"            RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "attendance_issue_events"  RENAME COLUMN "actor_user_id"               TO "actor_worker_id";
ALTER TABLE "api_call_logs"            RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "attendance_edit_requests" RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "worker_invites"           RENAME COLUMN "used_by_user_id"             TO "used_by_worker_id";
ALTER TABLE "worker_notices"           RENAME COLUMN "user_id"                     TO "worker_id";
ALTER TABLE "worker_notification_settings" RENAME COLUMN "user_id"                 TO "worker_id";

-- ─── 4. 인덱스 리네임 (이름만 정합화, 데이터 영향 없음) ─────────────────
ALTER INDEX "site_assignments_user_id_status_idx"              RENAME TO "site_assignments_worker_id_status_idx";
ALTER INDEX "daily_attendances_user_id_work_date_idx"          RENAME TO "daily_attendances_worker_id_work_date_idx";
ALTER INDEX "site_base_points_confirmed_by_user_id_idx"        RENAME TO "site_base_points_confirmed_by_worker_id_idx";
ALTER INDEX "submissions_submitted_by_user_id_submitted_at_idx" RENAME TO "submissions_submitted_by_worker_id_submitted_at_idx";
ALTER INDEX "employment_contracts_user_id_status_idx"          RENAME TO "employment_contracts_worker_id_status_idx";
ALTER INDEX "pay_contracts_agency_id_user_id_effective_from_idx" RENAME TO "pay_contracts_agency_id_worker_id_effective_from_idx";
ALTER INDEX "payroll_items_run_id_user_id_key"                 RENAME TO "payroll_items_run_id_worker_id_key";
ALTER INDEX "attendance_issue_events_actor_user_id_created_at_idx" RENAME TO "attendance_issue_events_actor_worker_id_created_at_idx";
ALTER INDEX "attendance_edit_requests_user_id_status_idx"      RENAME TO "attendance_edit_requests_worker_id_status_idx";
ALTER INDEX "worker_notices_user_id_read_at_idx"               RENAME TO "worker_notices_worker_id_read_at_idx";
ALTER INDEX "user_notification_settings_user_id_key"           RENAME TO "worker_notification_settings_worker_id_key";

-- ─── 5. 제약(FK/PK) 이름 정합화 ───────────────────────────────────────
ALTER TABLE "site_assignments"         RENAME CONSTRAINT "site_assignments_user_id_fkey"              TO "site_assignments_worker_id_fkey";
ALTER TABLE "daily_attendances"        RENAME CONSTRAINT "daily_attendances_user_id_fkey"             TO "daily_attendances_worker_id_fkey";
ALTER TABLE "document_runs"            RENAME CONSTRAINT "document_runs_worker_user_id_fkey"          TO "document_runs_worker_id_fkey";
ALTER TABLE "document_versions"        RENAME CONSTRAINT "document_versions_created_by_user_id_fkey"  TO "document_versions_created_by_worker_id_fkey";
ALTER TABLE "document_submission_logs" RENAME CONSTRAINT "document_submission_logs_submitted_by_user_id_fkey" TO "document_submission_logs_submitted_by_worker_id_fkey";
ALTER TABLE "site_base_points"         RENAME CONSTRAINT "site_base_points_confirmed_by_user_id_fkey" TO "site_base_points_confirmed_by_worker_id_fkey";
ALTER TABLE "submissions"              RENAME CONSTRAINT "submissions_submitted_by_user_id_fkey"      TO "submissions_submitted_by_worker_id_fkey";
ALTER TABLE "employment_contracts"     RENAME CONSTRAINT "employment_contracts_user_id_fkey"          TO "employment_contracts_worker_id_fkey";
ALTER TABLE "pay_contracts"            RENAME CONSTRAINT "pay_contracts_user_id_fkey"                 TO "pay_contracts_worker_id_fkey";
ALTER TABLE "payroll_items"            RENAME CONSTRAINT "payroll_items_user_id_fkey"                 TO "payroll_items_worker_id_fkey";
ALTER TABLE "attendance_issue_events"  RENAME CONSTRAINT "attendance_issue_events_actor_user_id_fkey" TO "attendance_issue_events_actor_worker_id_fkey";
ALTER TABLE "api_call_logs"            RENAME CONSTRAINT "api_call_logs_user_id_fkey"                 TO "api_call_logs_worker_id_fkey";
ALTER TABLE "attendance_edit_requests" RENAME CONSTRAINT "attendance_edit_requests_user_id_fkey"      TO "attendance_edit_requests_worker_id_fkey";
ALTER TABLE "worker_notices"           RENAME CONSTRAINT "worker_notices_user_id_fkey"                TO "worker_notices_worker_id_fkey";
ALTER TABLE "worker_notification_settings" RENAME CONSTRAINT "user_notification_settings_user_id_fkey" TO "worker_notification_settings_worker_id_fkey";
ALTER TABLE "worker_notification_settings" RENAME CONSTRAINT "user_notification_settings_pkey"         TO "worker_notification_settings_pkey";
