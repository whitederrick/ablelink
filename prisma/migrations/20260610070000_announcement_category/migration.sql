-- 공지 카테고리(운영자 전역 관리) + 공지 연결
CREATE TABLE "announcement_categories" (
  "id" BIGSERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "tone" TEXT NOT NULL DEFAULT 'sky',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "announcement_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcement_categories_is_active_sort_order_idx" ON "announcement_categories"("is_active", "sort_order");

-- 기본 3종 시드(긴급/주의/안내)
INSERT INTO "announcement_categories" ("name", "tone", "sort_order", "is_active", "updated_at") VALUES
  ('안내', 'sky',   0, true, CURRENT_TIMESTAMP),
  ('주의', 'amber', 1, true, CURRENT_TIMESTAMP),
  ('긴급', 'rose',  2, true, CURRENT_TIMESTAMP);

-- 공지에 카테고리 연결 컬럼
ALTER TABLE "agency_announcements" ADD COLUMN "category_id" BIGINT;

ALTER TABLE "agency_announcements"
  ADD CONSTRAINT "agency_announcements_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "announcement_categories"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
