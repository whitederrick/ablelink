-- 레거시 용어(coach) → worker 전면 정리
-- 모든 작업은 RENAME(메타데이터 변경)이므로 기존 데이터·기본값이 그대로 보존됩니다.
-- (DROP/ADD 없음 → 데이터 손실 없음)

-- ── 1. 컬럼명 변경 (RENAME COLUMN) ───────────────────────────
ALTER TABLE "document_runs"        RENAME COLUMN "coach_user_id"          TO "worker_user_id";
ALTER TABLE "document_runs"        RENAME COLUMN "coach_signed_at"        TO "worker_signed_at";
ALTER TABLE "agencies"             RENAME COLUMN "max_coaches"            TO "max_workers";
ALTER TABLE "site_assignments"     RENAME COLUMN "is_main_coach"          TO "is_main_worker";
ALTER TABLE "pay_contracts"        RENAME COLUMN "coach_type"             TO "worker_type";
ALTER TABLE "employment_contracts" RENAME COLUMN "coach_signed_at"        TO "worker_signed_at";
ALTER TABLE "employment_contracts" RENAME COLUMN "coach_signature_url"    TO "worker_signature_url";
ALTER TABLE "employment_contracts" RENAME COLUMN "coach_filled_site_name" TO "worker_filled_site_name";
ALTER TABLE "employment_contracts" RENAME COLUMN "coach_filled_work_type" TO "worker_filled_work_type";
ALTER TABLE "attendance_issues"    RENAME COLUMN "coach_reason_text"      TO "worker_reason_text";

-- ── 2. enum 타입명 변경 (RENAME TYPE) ────────────────────────
ALTER TYPE "CoachType" RENAME TO "WorkerType";

-- ── 3. enum 값 변경 (RENAME VALUE — 기존 행/기본값 자동 보존) ──
ALTER TYPE "UserRole"                 RENAME VALUE 'COACH'          TO 'WORKER';
ALTER TYPE "AttendanceIssueActorRole" RENAME VALUE 'COACH'          TO 'WORKER';
ALTER TYPE "SiteSourceType"           RENAME VALUE 'COACH_ENTRY'    TO 'WORKER_ENTRY';
ALTER TYPE "BasePointApprovalStatus"  RENAME VALUE 'COACH_PROPOSED' TO 'WORKER_PROPOSED';
ALTER TYPE "BasePointStage"           RENAME VALUE 'COACH_FINAL'    TO 'WORKER_FINAL';
ALTER TYPE "ActorType"                RENAME VALUE 'ADMIN_USER'     TO 'ADMIN';
