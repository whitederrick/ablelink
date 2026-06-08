-- 현장 담당 관리자(Manager 로그인). 같은 에이전시 안에서 관리자별로 현장 구분.
-- 추가형 nullable(미지정=공용) — 기존 행 하위호환.
ALTER TABLE "sites" ADD COLUMN "owner_manager_id" BIGINT;
ALTER TABLE "sites"
  ADD CONSTRAINT "sites_owner_manager_id_fkey"
  FOREIGN KEY ("owner_manager_id") REFERENCES "managers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sites_owner_manager_id_idx" ON "sites"("owner_manager_id");
