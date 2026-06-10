-- 시스템 공지 발송 대상: MANAGERS(에이전시 관리자만, 기본) | ALL(관리자+전체 직무지도원)
ALTER TABLE "system_announcements" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'MANAGERS';
