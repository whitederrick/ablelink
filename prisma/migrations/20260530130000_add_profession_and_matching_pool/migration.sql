-- 인력 pool / 직종·매칭 foundation (서비스 확장: 직무지도원 + 요양보호사 + 활동보호사)

-- CreateEnum
CREATE TYPE "Profession" AS ENUM ('JOB_COACH', 'CAREGIVER', 'ACTIVITY_ASSISTANT');

-- AlterTable: 인력 pool 매칭 속성
ALTER TABLE "workers"
    ADD COLUMN "residence_address" TEXT,
    ADD COLUMN "residence_lat" DECIMAL(65,30),
    ADD COLUMN "residence_lon" DECIMAL(65,30),
    ADD COLUMN "rating_avg" DECIMAL(65,30) NOT NULL DEFAULT 0,
    ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "bio" TEXT;

-- AlterTable: 직무/사이트 pool 매칭 속성
ALTER TABLE "sites"
    ADD COLUMN "business_type" TEXT,
    ADD COLUMN "required_profession" "Profession",
    ADD COLUMN "needed_activities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable: worker_professions
CREATE TABLE "worker_professions" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "profession" "Profession" NOT NULL,
    "cert_number" TEXT,
    "certified_at" TIMESTAMP(3),
    "experience_years" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_professions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: worker_experiences
CREATE TABLE "worker_experiences" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "profession" "Profession",
    "org_name" TEXT NOT NULL,
    "title" TEXT,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable: worker_reviews
CREATE TABLE "worker_reviews" (
    "id" BIGSERIAL NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "agency_id" BIGINT,
    "manager_id" BIGINT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "worker_professions_worker_id_profession_key" ON "worker_professions"("worker_id", "profession");
CREATE INDEX "worker_professions_profession_is_active_idx" ON "worker_professions"("profession", "is_active");
CREATE INDEX "worker_experiences_worker_id_idx" ON "worker_experiences"("worker_id");
CREATE INDEX "worker_reviews_worker_id_idx" ON "worker_reviews"("worker_id");
CREATE INDEX "worker_reviews_agency_id_idx" ON "worker_reviews"("agency_id");

-- AddForeignKey
ALTER TABLE "worker_professions" ADD CONSTRAINT "worker_professions_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_experiences" ADD CONSTRAINT "worker_experiences_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_reviews" ADD CONSTRAINT "worker_reviews_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_reviews" ADD CONSTRAINT "worker_reviews_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "worker_reviews" ADD CONSTRAINT "worker_reviews_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
