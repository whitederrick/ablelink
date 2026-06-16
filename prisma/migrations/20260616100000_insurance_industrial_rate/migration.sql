-- 산재보험 요율 컬럼 추가 (전액 사업주 부담, 표기용). 기존 행은 0으로 채움.
ALTER TABLE "insurance_rates" ADD COLUMN "industrial_accident" DECIMAL NOT NULL DEFAULT 0;
