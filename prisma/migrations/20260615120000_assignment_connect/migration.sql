-- 배정 연결(Phase 3, assignment-pipeline-design.md §7)
-- 기존 가입 직무지도원을 새 배정에 연결하기 위한 인증코드 토큰: WorkerInvite 확장.
--  - existing_worker_id: 기존 유저 연결용(계정 미생성, 코드검증만)
--  - assignment_id: 연결 대상 배정
--  - purpose: NEW_ACCOUNT(신규 가입) | CONNECT_EXISTING(기존 유저 연결)
ALTER TABLE "worker_invites"
  ADD COLUMN "existing_worker_id" BIGINT,
  ADD COLUMN "assignment_id"      BIGINT,
  ADD COLUMN "purpose"            TEXT NOT NULL DEFAULT 'NEW_ACCOUNT';

-- 연결 게이트 백필: 이미 운영 중인 ACTIVE 배정은 '연결됨'으로 간주(connected_at 백필).
--  → clock-in이 connected_at을 요구해도 기존 워커가 차단되지 않도록 grandfather.
UPDATE "site_assignments"
SET "connected_at" = COALESCE("base_confirmed_at", "assigned_at", NOW())
WHERE "status" = 'ACTIVE'
  AND "connected_at" IS NULL;
