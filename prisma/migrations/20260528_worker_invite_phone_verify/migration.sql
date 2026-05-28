-- AlterTable: User — 약관 동의 이력 필드 추가
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "consent_terms_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "consent_privacy_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "consent_location_at" TIMESTAMP(3);

-- CreateTable: PhoneVerification
CREATE TABLE IF NOT EXISTS "phone_verifications" (
    "id" BIGSERIAL NOT NULL,
    "phone_number" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "phone_verifications_phone_number_idx" ON "phone_verifications"("phone_number");

-- CreateTable: WorkerInvite
CREATE TABLE IF NOT EXISTS "worker_invites" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "site_id" BIGINT,
    "phone_number" TEXT NOT NULL,
    "worker_name" TEXT,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_user_id" BIGINT,
    "created_by_admin_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "worker_invites_code_idx" ON "worker_invites"("code");
CREATE INDEX IF NOT EXISTS "worker_invites_agency_id_idx" ON "worker_invites"("agency_id");

-- AddForeignKey
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
