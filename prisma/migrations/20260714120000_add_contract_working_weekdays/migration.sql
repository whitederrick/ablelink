-- 근무요일 집합(CSV, 0=일..6=토). null=미설정→파생(하위호환). 비연속 근무요일 주휴·MONTHLY 일할 정확화.
-- AlterTable
ALTER TABLE "employment_contracts" ADD COLUMN     "working_weekdays" TEXT;
