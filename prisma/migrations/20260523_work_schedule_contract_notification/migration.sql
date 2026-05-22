-- ============================================================
-- Feature A: 근무형태 정규화
-- ============================================================

-- 1. is_extra_time → commute_guidance_included 컬럼 이름 변경
ALTER TABLE "site_assignments" RENAME COLUMN "is_extra_time" TO "commute_guidance_included";

-- 2. CUSTOM 근무형태용 시작/종료 시각 추가
ALTER TABLE "site_assignments"
  ADD COLUMN IF NOT EXISTS "custom_work_start" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_work_end"   TEXT;

-- 3. 기존 work_type 값 표준화 ("AM" | "PM" | "FULL_DAY" | "CUSTOM")
UPDATE "site_assignments" SET "work_type" = 'FULL_DAY'
  WHERE "work_type" ILIKE '전일%' OR "work_type" = 'FULL' OR "work_type" = 'ALL';
UPDATE "site_assignments" SET "work_type" = 'AM'
  WHERE "work_type" ILIKE '오전%';
UPDATE "site_assignments" SET "work_type" = 'PM'
  WHERE "work_type" ILIKE '오후%';

-- FULL_DAY 배정은 commute_guidance_included 강제 false (법적 8시간 제한)
UPDATE "site_assignments" SET "commute_guidance_included" = false
  WHERE "work_type" = 'FULL_DAY';

-- ============================================================
-- Feature B: 근로계약서 (Employment Contract)
-- ============================================================

CREATE TABLE IF NOT EXISTS "employment_contracts" (
  "id"               BIGSERIAL PRIMARY KEY,
  "agency_id"        BIGINT NOT NULL REFERENCES "agencies"("id"),
  "user_id"          BIGINT NOT NULL REFERENCES "users"("id"),
  "assignment_id"    BIGINT REFERENCES "site_assignments"("id"),

  "contract_start"   TIMESTAMPTZ NOT NULL,
  "contract_end"     TIMESTAMPTZ NOT NULL,

  -- 관리자가 미리 입력 (없으면 직무지도원 직접 입력)
  "site_name"                   TEXT,
  "work_type"                   TEXT,
  "commute_guidance_included"   BOOLEAN NOT NULL DEFAULT true,
  "custom_work_start"           TEXT,
  "custom_work_end"             TEXT,

  -- 카카오 링크 서명 토큰
  "sign_token"       TEXT NOT NULL UNIQUE,
  "token_sent_at"    TIMESTAMPTZ,
  "token_expires_at" TIMESTAMPTZ NOT NULL,

  -- 서명 상태
  "status"                  TEXT NOT NULL DEFAULT 'PENDING',
  "coach_signed_at"         TIMESTAMPTZ,
  "coach_signature_url"     TEXT,
  "admin_signed_at"         TIMESTAMPTZ,
  "admin_signature_url"     TEXT,

  -- 직무지도원 직접 입력
  "coach_filled_site_name"  TEXT,
  "coach_filled_work_type"  TEXT,

  "pdf_url"               TEXT,
  "admin_memo"            TEXT,
  "created_by_admin_id"   BIGINT,

  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "employment_contracts_agency_id_status_idx"
  ON "employment_contracts"("agency_id", "status");
CREATE INDEX IF NOT EXISTS "employment_contracts_user_id_status_idx"
  ON "employment_contracts"("user_id", "status");
CREATE INDEX IF NOT EXISTS "employment_contracts_sign_token_idx"
  ON "employment_contracts"("sign_token");

-- ============================================================
-- Feature C: 알람 설정 (Notification Settings)
-- ============================================================

CREATE TABLE IF NOT EXISTS "user_notification_settings" (
  "id"                    BIGSERIAL PRIMARY KEY,
  "user_id"               BIGINT NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "clock_in_alert_minutes"  INT NOT NULL DEFAULT 3,
  "clock_out_alert_minutes" INT NOT NULL DEFAULT 3,
  "push_subscription"     JSONB,
  "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
