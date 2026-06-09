-- 직무지도원 만족도 조사 (사업체 담당자 → 직무지도원 평가) — PRO
-- 신규 테이블만 추가 — 기존 영향 없음

CREATE TABLE "satisfaction_surveys" (
  "id"                    BIGSERIAL    NOT NULL,
  "agency_id"             BIGINT       NOT NULL,
  "worker_id"             BIGINT       NOT NULL,
  "contract_id"           BIGINT,
  "recipient_name"        TEXT,
  "recipient_phone"       TEXT         NOT NULL,
  "site_name"             TEXT,
  "token"                 TEXT         NOT NULL,
  "status"                TEXT         NOT NULL DEFAULT 'PENDING',
  "auto"                  BOOLEAN      NOT NULL DEFAULT false,
  "scores"                JSONB,
  "overall_score"         INTEGER,
  "comment"               TEXT,
  "shared_with_agency"    BOOLEAN      NOT NULL DEFAULT false,
  "sent_at"               TIMESTAMP(3),
  "responded_at"          TIMESTAMP(3),
  "expires_at"            TIMESTAMP(3) NOT NULL,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL,
  "created_by_manager_id" BIGINT,
  CONSTRAINT "satisfaction_surveys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "satisfaction_surveys_token_key" ON "satisfaction_surveys"("token");
CREATE INDEX "satisfaction_surveys_agency_id_status_idx" ON "satisfaction_surveys"("agency_id", "status");
CREATE INDEX "satisfaction_surveys_worker_id_idx" ON "satisfaction_surveys"("worker_id");
CREATE INDEX "satisfaction_surveys_token_idx" ON "satisfaction_surveys"("token");

ALTER TABLE "satisfaction_surveys"
  ADD CONSTRAINT "satisfaction_surveys_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "satisfaction_surveys"
  ADD CONSTRAINT "satisfaction_surveys_worker_id_fkey"
  FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
