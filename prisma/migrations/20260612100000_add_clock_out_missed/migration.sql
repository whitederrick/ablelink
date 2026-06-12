-- 퇴근 미실행 처리: 출근했으나 퇴근 버튼을 안 누른 채 날이 바뀐 기록을 '보정대기'로 두고,
-- 직무지도원이 늦게 사유와 함께 퇴근 처리하거나 매니저가 표준시각으로 확정할 수 있도록 컬럼 추가.
ALTER TABLE "daily_attendances"
  ADD COLUMN "clock_out_missed_at"        TIMESTAMP(3),
  ADD COLUMN "late_clock_out_at"          TIMESTAMP(3),
  ADD COLUMN "late_clock_out_reason_code" TEXT,
  ADD COLUMN "late_clock_out_reason"      TEXT;
