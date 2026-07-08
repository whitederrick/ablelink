-- 성능 인덱스 2종 (리뷰 PERF-4·PERF-5, 2026-07-08)
--  · daily_attendances(work_date): cron 전일처리·CSV·운영자 조회가 work_date 단독 필터 → 풀스캔 방지.
--  · document_runs(agency_id, updated_at): 문서함(inbox)·ZIP·대시보드가 agency + updated_at desc 정렬 조회.
-- 이름은 Prisma 규칙(@@index 기본명)과 일치시켜 스키마·DB 드리프트 없음.

CREATE INDEX IF NOT EXISTS "daily_attendances_work_date_idx"
  ON "daily_attendances" ("work_date");

CREATE INDEX IF NOT EXISTS "document_runs_agency_id_updated_at_idx"
  ON "document_runs" ("agency_id", "updated_at");
