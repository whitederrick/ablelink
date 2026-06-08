-- 현장 사업체 담당자(현장 회사 연락 담당자) 영속 필드. 추가형 nullable — 기존 행 하위호환.
-- 기존 managerId(=AgencyManager, 에이전시측 연락처)는 레거시로 유지.
ALTER TABLE "sites" ADD COLUMN "business_contact_name" TEXT;
ALTER TABLE "sites" ADD COLUMN "business_contact_phone" TEXT;
