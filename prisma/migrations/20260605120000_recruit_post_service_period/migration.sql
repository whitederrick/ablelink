-- 매칭 공고 직무지도 기간(겹침 판정 기준). 추가형 nullable — 기존 행 하위호환.
ALTER TABLE "recruit_posts" ADD COLUMN "service_start" TIMESTAMP(3);
ALTER TABLE "recruit_posts" ADD COLUMN "service_end" TIMESTAMP(3);
