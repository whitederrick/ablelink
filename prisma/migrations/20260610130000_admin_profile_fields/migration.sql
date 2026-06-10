-- 시스템 운영자 상세 정보(이메일·연락처·메모) 추가
ALTER TABLE "admins" ADD COLUMN "email" TEXT;
ALTER TABLE "admins" ADD COLUMN "phone" TEXT;
ALTER TABLE "admins" ADD COLUMN "note" TEXT;
