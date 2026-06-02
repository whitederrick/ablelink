-- 방향 B 자동 배정: 제안(TalentOffer)에 실제 현장 연결 → 후보자 수락 시 해당 현장으로 배정.
-- talent_offers.site_id (nullable FK → sites.id). 미연결 제안은 기존처럼 ACCEPTED 표시만.
ALTER TABLE "talent_offers" ADD COLUMN "site_id" BIGINT;

ALTER TABLE "talent_offers"
  ADD CONSTRAINT "talent_offers_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
