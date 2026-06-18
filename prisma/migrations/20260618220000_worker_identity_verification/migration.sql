-- 본인 확인(신원) 결과 — 이미지 비보관, 결과값만 (P3 골격). CI는 기존 ci_key 재활용.
ALTER TABLE "workers"
  ADD COLUMN "identity_verified_at" TIMESTAMP(3),
  ADD COLUMN "identity_method" TEXT,
  ADD COLUMN "identity_verified_by" BIGINT;
