-- 직종 자격 증빙·검증 (마켓플레이스 직종 증명형 가입/등록)

-- CreateEnum
CREATE TYPE "ProfessionVerifyStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable: worker_professions 검증 필드 추가
ALTER TABLE "worker_professions"
    ADD COLUMN "cert_doc_url" TEXT,
    ADD COLUMN "verify_status" "ProfessionVerifyStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "verified_at" TIMESTAMP(3),
    ADD COLUMN "verified_by_admin_id" BIGINT;

-- Index
CREATE INDEX "worker_professions_verify_status_idx" ON "worker_professions"("verify_status");
