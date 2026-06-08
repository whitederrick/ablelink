-- 레거시 AgencyManager(기관 담당자) 완전 제거.
-- 현장 담당자는 Site.businessContact*(사업체 담당자), 관리자 구분은 Site.ownerManagerId(Manager 로그인)로 운영.
ALTER TABLE "sites" DROP CONSTRAINT IF EXISTS "sites_manager_id_fkey";
ALTER TABLE "sites" DROP COLUMN IF EXISTS "manager_id";
DROP TABLE IF EXISTS "agency_managers";
