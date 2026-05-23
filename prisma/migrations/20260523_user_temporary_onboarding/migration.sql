-- 직무지도원 온보딩 플로우 지원
-- 계약서 서명으로 신규 생성된 계정을 추적하고 이메일 인증 코드 보관

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "is_temporary"           BOOLEAN   NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "pending_login_id"        TEXT,
  ADD COLUMN IF NOT EXISTS "verify_code"             TEXT,
  ADD COLUMN IF NOT EXISTS "verify_code_expires_at"  TIMESTAMPTZ;
