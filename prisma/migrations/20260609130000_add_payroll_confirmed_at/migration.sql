-- 급여 보호 게이트: 심한 지각(실제 출근 30분+ 지각) 미컨펌 날의 출근부 기본값 확정 보류 신호.
-- 에이전시가 보정 승인/명시적 확정하면 채워지고, 그때부터 출근부가 확정된다.
ALTER TABLE "daily_attendances" ADD COLUMN "payroll_confirmed_at" TIMESTAMP(3);
