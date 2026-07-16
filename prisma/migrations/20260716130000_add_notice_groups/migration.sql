-- 알림 커스텀 수신 그룹(2026-07-16) — 매니저가 임의 워커 묶음을 저장해 반복 발송.
-- 순수 추가(CREATE만) — 기존 테이블 무변경.

-- CreateTable
CREATE TABLE "notice_groups" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_manager_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notice_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notice_group_members" (
    "id" BIGSERIAL NOT NULL,
    "group_id" BIGINT NOT NULL,
    "worker_id" BIGINT NOT NULL,

    CONSTRAINT "notice_group_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notice_groups_agency_id_name_key" ON "notice_groups"("agency_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "notice_group_members_group_id_worker_id_key" ON "notice_group_members"("group_id", "worker_id");

-- CreateIndex
CREATE INDEX "notice_group_members_worker_id_idx" ON "notice_group_members"("worker_id");

-- AddForeignKey
ALTER TABLE "notice_groups" ADD CONSTRAINT "notice_groups_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_group_members" ADD CONSTRAINT "notice_group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "notice_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notice_group_members" ADD CONSTRAINT "notice_group_members_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
