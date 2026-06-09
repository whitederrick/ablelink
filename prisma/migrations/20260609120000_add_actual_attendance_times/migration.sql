-- 실제 출퇴근 버튼 시각 저장(정상 출근 확인용). 출근부 PDF는 기존 start_time/end_time(근무형태 고정시각) 사용.
-- 추가형 nullable — 기존 행 하위호환.
ALTER TABLE "daily_attendances" ADD COLUMN "actual_start_time" TIMESTAMP(3);
ALTER TABLE "daily_attendances" ADD COLUMN "actual_end_time" TIMESTAMP(3);
