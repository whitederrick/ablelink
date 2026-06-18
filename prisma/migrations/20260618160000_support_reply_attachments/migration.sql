-- 운영자 답변 첨부파일: [{ path, name, size, mime }] JSON 배열
ALTER TABLE "support_tickets" ADD COLUMN "reply_attachments" JSONB;
