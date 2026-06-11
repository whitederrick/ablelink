-- 에이전시→직무지도원 '시각 보정 요청' 추적 컬럼 (급여 보호 게이트 보정대기일 처리)
ALTER TABLE "daily_attendances"
  ADD COLUMN "correction_requested_at" TIMESTAMP(3),
  ADD COLUMN "correction_request_note" TEXT;
