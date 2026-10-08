-- AlterTable
-- 기존 행은 1970-01-01로 채워(= 어떤 급여 초안보다 오래됨) 배포 직후 기존 초안이 '변경됨'으로 오탐되지 않게 하고,
-- 이후 신규 행의 기본값은 now()로 바꾼다. 수정 시 갱신은 Prisma @updatedAt이 담당.
-- IF NOT EXISTS: 여러 번 실행해도 안전(수동 적용 후 migrate deploy와 겹쳐도 실패하지 않게).
ALTER TABLE "daily_attendances" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00';
ALTER TABLE "daily_attendances" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
