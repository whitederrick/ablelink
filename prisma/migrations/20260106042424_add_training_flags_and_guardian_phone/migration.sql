-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'COACH');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'RESIGNED', 'PAUSED');

-- CreateEnum
CREATE TYPE "AssignStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "TraineeStatus" AS ENUM ('TRAINING', 'EMPLOYED', 'DROPOUT', 'PAUSED');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('WORKING', 'DONE', 'ABSENT');

-- CreateTable
CREATE TABLE "common_codes" (
    "code_group" TEXT NOT NULL,
    "code_value" TEXT NOT NULL,
    "code_name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "common_codes_pkey" PRIMARY KEY ("code_group","code_value")
);

-- CreateTable
CREATE TABLE "users" (
    "id" BIGSERIAL NOT NULL,
    "login_id" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'COACH',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "ci_key" TEXT,
    "signature_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" BIGSERIAL NOT NULL,
    "company_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "detail_address" TEXT,
    "gps_lat" DECIMAL(65,30) NOT NULL,
    "gps_lon" DECIMAL(65,30) NOT NULL,
    "allowance_range" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "agency_id" BIGINT,
    "noPreTraining" BOOLEAN NOT NULL DEFAULT false,
    "noFieldTraining" BOOLEAN NOT NULL DEFAULT false,
    "field_training_end" TIMESTAMP(3),
    "field_training_start" TIMESTAMP(3),
    "is_extra_time" BOOLEAN NOT NULL DEFAULT false,
    "manager_id" BIGINT,
    "pre_training_end" TIMESTAMP(3),
    "pre_training_start" TIMESTAMP(3),
    "work_type" TEXT,

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_assignments" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "status" "AssignStatus" NOT NULL DEFAULT 'ACTIVE',
    "start_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_date" TIMESTAMP(3),
    "is_main_coach" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "site_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainees" (
    "id" BIGSERIAL NOT NULL,
    "current_site_id" BIGINT,
    "name" TEXT NOT NULL,
    "birth_date" TEXT,
    "gender" TEXT NOT NULL,
    "phone_number" TEXT,
    "guardianPhoneNumber" TEXT,
    "disability_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRAINING',
    "leftAt" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_placements" (
    "id" BIGSERIAL NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL,

    CONSTRAINT "trainee_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_attendances" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "site_id" BIGINT NOT NULL,
    "work_date" TEXT NOT NULL,
    "start_time" TIMESTAMP(3),
    "start_loc_lat" DECIMAL(65,30),
    "start_loc_lon" DECIMAL(65,30),
    "end_time" TIMESTAMP(3),
    "end_loc_lat" DECIMAL(65,30),
    "end_loc_lon" DECIMAL(65,30),
    "is_gps_modified" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorkStatus" NOT NULL DEFAULT 'WORKING',
    "is_final_closed" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(6),

    CONSTRAINT "daily_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agencies" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agency_managers" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone_number" TEXT,

    CONSTRAINT "agency_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_logs" (
    "id" BIGSERIAL NOT NULL,
    "attendance_id" BIGINT NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "writer_id" BIGINT NOT NULL,
    "training_type" TEXT NOT NULL,
    "time_1on1" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "time_group" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "content" TEXT,
    "evaluation" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "ext_time_1on1" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ext_time_group" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total_recognized_time" DECIMAL(65,30) NOT NULL DEFAULT 0,

    CONSTRAINT "trainee_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_log_tasks" (
    "id" BIGSERIAL NOT NULL,
    "log_id" BIGINT NOT NULL,
    "task_name" TEXT NOT NULL,
    "performance_score" INTEGER NOT NULL,
    "difficulty" TEXT,
    "feedback" TEXT,

    CONSTRAINT "trainee_log_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_login_id_key" ON "users"("login_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_ci_key_key" ON "users"("ci_key");

-- CreateIndex
CREATE INDEX "site_assignments_user_id_status_idx" ON "site_assignments"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attendances_user_id_work_date_key" ON "daily_attendances"("user_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_name_key" ON "agencies"("name");

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "agency_managers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainees" ADD CONSTRAINT "trainees_current_site_id_fkey" FOREIGN KEY ("current_site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_placements" ADD CONSTRAINT "trainee_placements_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_placements" ADD CONSTRAINT "trainee_placements_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_attendances" ADD CONSTRAINT "daily_attendances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_managers" ADD CONSTRAINT "agency_managers_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "daily_attendances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_logs" ADD CONSTRAINT "trainee_logs_writer_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_log_tasks" ADD CONSTRAINT "trainee_log_tasks_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "trainee_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
