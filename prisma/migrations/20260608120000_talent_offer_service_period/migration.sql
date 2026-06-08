-- 인재풀 제안(방향 B) 직무지도 기간(겹침 판정·자동배정 기간 기준). 추가형 nullable — 기존 행 하위호환.
ALTER TABLE "talent_offers" ADD COLUMN "service_start" TIMESTAMP(3);
ALTER TABLE "talent_offers" ADD COLUMN "service_end" TIMESTAMP(3);
