-- 에이전시 관리자(AdminUser)에 서명 URL 추가
-- 테이블명: "AdminUser" (Prisma가 @@map 없이 생성한 대소문자 그대로)
ALTER TABLE "AdminUser" ADD COLUMN IF NOT EXISTS "signature_url" TEXT;

-- 사업체담당자 즉석 서명 토큰 테이블
CREATE TABLE IF NOT EXISTS "site_sign_tokens" (
  "id"            BIGSERIAL PRIMARY KEY,
  "token"         TEXT NOT NULL UNIQUE,
  "doc_type"      TEXT NOT NULL,
  "assignment_id" BIGINT NOT NULL REFERENCES "site_assignments"("id") ON DELETE CASCADE,
  "period_start"  TEXT NOT NULL,
  "period_end"    TEXT NOT NULL,
  "sign_role"     TEXT NOT NULL,
  "signer_name"   TEXT,
  "signature_url" TEXT,
  "used_at"       TIMESTAMPTZ,
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "site_sign_tokens_token_idx"         ON "site_sign_tokens"("token");
CREATE INDEX IF NOT EXISTS "site_sign_tokens_assignment_id_idx" ON "site_sign_tokens"("assignment_id");