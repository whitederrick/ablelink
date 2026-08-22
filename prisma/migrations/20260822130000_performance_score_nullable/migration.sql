-- 수행정도(performance_score) 미입력 허용.
-- 종전에는 NOT NULL 이라 저장 라우트가 미선택 시 3(보통)을 채웠고, 실제로 '보통'을 고른 것과 구분되지 않았다.
-- 기관에 따라 일지에 측정시간만 기재하므로 미입력 상태가 필요하다(사용자 확정 2026-08-22).
-- ★기존 행은 건드리지 않는다 — 이미 저장된 3은 소급 판별이 불가능해 신규 작성분부터 적용한다.
ALTER TABLE "trainee_log_tasks" ALTER COLUMN "performance_score" DROP NOT NULL;
