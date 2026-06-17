-- 만족도 평가를 배정(현장 근무 단위)에 묶기: assignmentId 추가(additive). 근무 종료=배정 종료 기준.
ALTER TABLE "satisfaction_surveys" ADD COLUMN "assignment_id" BIGINT;
