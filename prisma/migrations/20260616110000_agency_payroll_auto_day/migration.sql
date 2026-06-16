-- 급여 자동 DRAFT 생성일(매월 N일). null = 자동 생성 안 함.
ALTER TABLE "agencies" ADD COLUMN "payroll_auto_day" INTEGER;
