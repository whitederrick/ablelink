-- 위탁기관별 지각 인정 기준(분). 기본 30.
ALTER TABLE "agencies" ADD COLUMN "late_threshold_min" INTEGER NOT NULL DEFAULT 30;
