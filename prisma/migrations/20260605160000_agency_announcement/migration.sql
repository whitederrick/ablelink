-- 에이전시 공지 게시판
CREATE TABLE "agency_announcements" (
  "id"                     BIGSERIAL    NOT NULL,
  "agency_id"              BIGINT       NOT NULL,
  "title"                  TEXT         NOT NULL,
  "body"                   TEXT         NOT NULL,
  "type"                   TEXT         NOT NULL DEFAULT 'INFO',
  "pinned"                 BOOLEAN      NOT NULL DEFAULT false,
  "created_by_manager_id"  BIGINT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agency_announcements_agency_id_pinned_created_at_idx"
  ON "agency_announcements"("agency_id", "pinned", "created_at");
