-- 배정 요청 재설계 P0
--  - AssignStatus: REQUESTED(요청 중) / ACCEPTED(수락·최종확정 대기) / EXPIRED(회신기한 초과 탈락)
--  - site_assignments: requested_work_types(요청 근무형태 CSV) + reply_deadline(회신 기한)
--  - sites: 근무형태별 정원(오전/오후/전일)

ALTER TYPE "AssignStatus" ADD VALUE IF NOT EXISTS 'REQUESTED';
ALTER TYPE "AssignStatus" ADD VALUE IF NOT EXISTS 'ACCEPTED';
ALTER TYPE "AssignStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "site_assignments"
  ADD COLUMN "requested_work_types" TEXT,
  ADD COLUMN "reply_deadline" TIMESTAMP(3);

ALTER TABLE "sites"
  ADD COLUMN "am_capacity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pm_capacity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "full_day_capacity" INTEGER NOT NULL DEFAULT 0;
