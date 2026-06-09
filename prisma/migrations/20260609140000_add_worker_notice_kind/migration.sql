-- 알림/공지 통합: WorkerNotice 뱃지 구분(공지/전체/그룹/개별).
-- 기존 행(시스템 업무 알림)은 개별로 간주.
ALTER TABLE "worker_notices" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'NOTICE_INDIVIDUAL';
