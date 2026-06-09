-- 근로계약서: 고용노동부 표준양식(단시간근로자) 항목 추가 + 에이전시별 특약 조항 마스터
-- 전부 추가형(nullable/기본값) — 기존 데이터·쿼리 영향 없음

-- AlterTable: employment_contracts 표준양식 항목
ALTER TABLE "employment_contracts"
  ADD COLUMN "work_location"        TEXT,
  ADD COLUMN "job_description"      TEXT,
  ADD COLUMN "work_start_time"      TEXT,
  ADD COLUMN "work_end_time"        TEXT,
  ADD COLUMN "break_start_time"     TEXT,
  ADD COLUMN "break_end_time"       TEXT,
  ADD COLUMN "work_days_per_week"   INTEGER,
  ADD COLUMN "weekly_holiday"       TEXT,
  ADD COLUMN "wage_type"            TEXT,
  ADD COLUMN "wage_amount"          INTEGER,
  ADD COLUMN "bonus_exists"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bonus_amount"         INTEGER,
  ADD COLUMN "extra_pay_exists"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "extra_pay_desc"       TEXT,
  ADD COLUMN "overtime_rate"        INTEGER,
  ADD COLUMN "wage_payday"          TEXT,
  ADD COLUMN "wage_pay_method"      TEXT,
  ADD COLUMN "employer_biz_name"    TEXT,
  ADD COLUMN "employer_phone"       TEXT,
  ADD COLUMN "employer_address"     TEXT,
  ADD COLUMN "employer_rep_name"    TEXT,
  ADD COLUMN "worker_address"       TEXT,
  ADD COLUMN "worker_filled_address" TEXT,
  ADD COLUMN "special_clauses"      JSONB;

-- CreateTable: agency_contract_clauses (에이전시별 특약 조항 마스터)
CREATE TABLE "agency_contract_clauses" (
  "id"         BIGSERIAL    NOT NULL,
  "agency_id"  BIGINT       NOT NULL,
  "title"      TEXT         NOT NULL,
  "body"       TEXT         NOT NULL,
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "is_active"  BOOLEAN      NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_contract_clauses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agency_contract_clauses_agency_id_is_active_idx"
  ON "agency_contract_clauses"("agency_id", "is_active");

ALTER TABLE "agency_contract_clauses"
  ADD CONSTRAINT "agency_contract_clauses_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
