-- 계좌 인증(예금주 조회) 결과 — 이미지 비보관, 결과값만 (P1 골격)
ALTER TABLE "workers"
  ADD COLUMN "bank_code" TEXT,
  ADD COLUMN "account_verified_at" TIMESTAMP(3),
  ADD COLUMN "account_holder_verified" BOOLEAN,
  ADD COLUMN "account_verify_method" TEXT;
