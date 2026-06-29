-- 현장별 공단 담당자(JSON). 비우면 기관 기본값 사용.
ALTER TABLE "sites" ADD COLUMN "gov_contacts" JSONB;
