-- 현장별 지각 인정 기준(분). null=위탁기관 기본값 상속.
ALTER TABLE "sites" ADD COLUMN "late_threshold_min" INTEGER;
