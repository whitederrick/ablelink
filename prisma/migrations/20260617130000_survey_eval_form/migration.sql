-- 만족도 평가 → 직무지도원 역량 평가표 승격: 요청 시점 평가표 스냅샷 + 채점 결과 컬럼(additive)
ALTER TABLE "satisfaction_surveys" ADD COLUMN "form_id" BIGINT;
ALTER TABLE "satisfaction_surveys" ADD COLUMN "form_snapshot" JSONB;
ALTER TABLE "satisfaction_surveys" ADD COLUMN "category_scores" JSONB;
ALTER TABLE "satisfaction_surveys" ADD COLUMN "total_score" INTEGER;
