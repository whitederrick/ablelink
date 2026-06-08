-- 사업체 담당자 이메일(문서 이메일 수신용). 추가형 nullable — 기존 행 하위호환.
ALTER TABLE "sites" ADD COLUMN "business_contact_email" TEXT;
