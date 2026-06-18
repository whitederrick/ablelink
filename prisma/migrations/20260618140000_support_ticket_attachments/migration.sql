-- 운영자 문의 첨부파일: [{ path, name, size, mime }] JSON 배열
ALTER TABLE "support_tickets" ADD COLUMN "attachments" JSONB;
