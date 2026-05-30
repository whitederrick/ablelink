-- 무손실 리네임: User(직무지도원) 잔재 → Worker
-- 모든 변경은 ALTER ... RENAME 으로 데이터/FK/인덱스를 보존한다.
-- ※ 제약·인덱스의 "이름"은 runtime/Prisma 쿼리에 무관하므로 정합화하지 않는다
--   (coach 시절 잔재 이름이 섞여 있어 RENAME 소스명을 신뢰할 수 없음).
--   컬럼/타입/테이블 RENAME 시 종속 인덱스·FK는 자동으로 새 컬럼을 따라간다.

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
