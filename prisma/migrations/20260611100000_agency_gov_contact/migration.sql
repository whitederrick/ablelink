-- 일지 관리 '문서 발송' 기본 수신자(장애인고용공단 담당자)
ALTER TABLE "agencies" ADD COLUMN "gov_contact_email" TEXT;
ALTER TABLE "agencies" ADD COLUMN "gov_contact_name" TEXT;
