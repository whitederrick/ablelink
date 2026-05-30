-- 직무지도 매칭 마켓플레이스 (확대 서비스, 느슨 결합 모듈)

-- CreateEnum
CREATE TYPE "RecruitStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "RecruitApplicationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable: recruit_posts
CREATE TABLE "recruit_posts" (
    "id" BIGSERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "profession" "Profession" NOT NULL DEFAULT 'JOB_COACH',
    "task_name" TEXT,
    "address" TEXT NOT NULL,
    "detail_address" TEXT,
    "lat" DECIMAL(65,30),
    "lon" DECIMAL(65,30),
    "region" TEXT,
    "work_hours" TEXT,
    "work_days" TEXT,
    "pay_info" TEXT,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT,
    "status" "RecruitStatus" NOT NULL DEFAULT 'OPEN',
    "agency_id" BIGINT,
    "created_by_manager_id" BIGINT,
    "created_by_admin_id" BIGINT,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruit_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: recruit_applications
CREATE TABLE "recruit_applications" (
    "id" BIGSERIAL NOT NULL,
    "recruit_post_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,
    "message" TEXT,
    "status" "RecruitApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recruit_applications_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "recruit_posts_status_profession_idx" ON "recruit_posts"("status", "profession");
CREATE INDEX "recruit_posts_agency_id_idx" ON "recruit_posts"("agency_id");
CREATE INDEX "recruit_posts_created_by_manager_id_idx" ON "recruit_posts"("created_by_manager_id");
CREATE UNIQUE INDEX "recruit_applications_recruit_post_id_worker_id_key" ON "recruit_applications"("recruit_post_id", "worker_id");
CREATE INDEX "recruit_applications_worker_id_status_idx" ON "recruit_applications"("worker_id", "status");
CREATE INDEX "recruit_applications_recruit_post_id_status_idx" ON "recruit_applications"("recruit_post_id", "status");

-- ForeignKeys
ALTER TABLE "recruit_posts" ADD CONSTRAINT "recruit_posts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recruit_applications" ADD CONSTRAINT "recruit_applications_recruit_post_id_fkey" FOREIGN KEY ("recruit_post_id") REFERENCES "recruit_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recruit_applications" ADD CONSTRAINT "recruit_applications_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
