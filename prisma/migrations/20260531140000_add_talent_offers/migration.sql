-- 방향 B: 후보자 이력서 공개(openToOffers) + 에이전시 제안(TalentOffer)

-- CreateEnum
CREATE TYPE "TalentOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- AlterTable: 구직중 공개 플래그
ALTER TABLE "workers" ADD COLUMN "open_to_offers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: talent_offers
CREATE TABLE "talent_offers" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "agency_id" BIGINT,
    "created_by_manager_id" BIGINT,
    "created_by_admin_id" BIGINT,
    "profession" "Profession",
    "site_name" TEXT,
    "message" TEXT,
    "status" "TalentOfferStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "talent_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "talent_offers_worker_id_status_idx" ON "talent_offers"("worker_id", "status");
CREATE INDEX "talent_offers_agency_id_status_idx" ON "talent_offers"("agency_id", "status");
CREATE INDEX "talent_offers_created_by_manager_id_idx" ON "talent_offers"("created_by_manager_id");

ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "talent_offers" ADD CONSTRAINT "talent_offers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
