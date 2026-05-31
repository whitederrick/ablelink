-- 방향 A 자동 배정: 매칭(RecruitApplication) 수락 시 생성/연계된 운영 Site 링크
-- recruit_posts.site_id (nullable FK → sites.id). 첫 수락 시 Site 생성 후 재사용(headcount>1).
ALTER TABLE "recruit_posts" ADD COLUMN "site_id" BIGINT;

ALTER TABLE "recruit_posts"
  ADD CONSTRAINT "recruit_posts_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "sites"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "recruit_posts_site_id_idx" ON "recruit_posts"("site_id");
