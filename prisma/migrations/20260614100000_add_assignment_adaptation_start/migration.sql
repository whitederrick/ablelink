-- 단일 배정 내 지원고용 훈련 → 적응지도 '전환일'(적응지도 시작일).
-- null이면 단건. 설정 시 전체 계약기간을 전환일 기준으로 두 구분으로 나눈다.
ALTER TABLE "site_assignments"
  ADD COLUMN "adaptation_start_date" TIMESTAMP(3);
