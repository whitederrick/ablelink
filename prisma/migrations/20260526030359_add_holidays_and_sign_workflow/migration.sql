/*
  Warnings:

  - The `status` column on the `employment_contracts` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[toss_customer_key]` on the table `agencies` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[subscription_id]` on the table `agencies` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('PENDING', 'SIGNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgencyPlanType" AS ENUM ('FREE', 'TRIAL', 'STARTER', 'STANDARD', 'PRO');

-- DropForeignKey
ALTER TABLE "employment_contracts" DROP CONSTRAINT "employment_contracts_agency_id_fkey";

-- DropForeignKey
ALTER TABLE "employment_contracts" DROP CONSTRAINT "employment_contracts_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "employment_contracts" DROP CONSTRAINT "employment_contracts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "site_sign_tokens" DROP CONSTRAINT "site_sign_tokens_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "user_notification_settings" DROP CONSTRAINT "user_notification_settings_user_id_fkey";

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "max_coaches" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max_sites" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_billing_at" TIMESTAMP(3),
ADD COLUMN     "plan_type" "AgencyPlanType" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "subscribed_at" TIMESTAMP(3),
ADD COLUMN     "subscription_id" TEXT,
ADD COLUMN     "toss_billing_key" TEXT,
ADD COLUMN     "toss_customer_key" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "trial_started_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "document_runs" ADD COLUMN     "agency_signature_url" TEXT,
ADD COLUMN     "agency_signed_at" TIMESTAMP(3),
ADD COLUMN     "coach_signed_at" TIMESTAMP(3),
ADD COLUMN     "manager_signature_url" TEXT,
ADD COLUMN     "manager_signed_at" TIMESTAMP(3),
ADD COLUMN     "manager_signer_name" TEXT,
ADD COLUMN     "requires_manager_sign" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sign_stage" TEXT NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "employment_contracts" ALTER COLUMN "contract_start" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "contract_end" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "token_sent_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "token_expires_at" SET DATA TYPE TIMESTAMP(3),
DROP COLUMN "status",
ADD COLUMN     "status" "ContractStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "coach_signed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "admin_signed_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "site_assignments" ALTER COLUMN "commute_guidance_included" SET DEFAULT true;

-- AlterTable
ALTER TABLE "site_sign_tokens" ALTER COLUMN "used_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "expires_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "user_notification_settings" ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "verify_code_expires_at" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "site_holidays" (
    "id" BIGSERIAL NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainee_evaluations" (
    "id" BIGSERIAL NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "writer_id" BIGINT NOT NULL,
    "eval_type" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "comments" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainee_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_holidays_assignment_id_idx" ON "site_holidays"("assignment_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_holidays_assignment_id_date_key" ON "site_holidays"("assignment_id", "date");

-- CreateIndex
CREATE INDEX "trainee_evaluations_trainee_id_eval_type_idx" ON "trainee_evaluations"("trainee_id", "eval_type");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_toss_customer_key_key" ON "agencies"("toss_customer_key");

-- CreateIndex
CREATE UNIQUE INDEX "agencies_subscription_id_key" ON "agencies"("subscription_id");

-- CreateIndex
CREATE INDEX "agencies_plan_type_idx" ON "agencies"("plan_type");

-- CreateIndex
CREATE INDEX "employment_contracts_agency_id_status_idx" ON "employment_contracts"("agency_id", "status");

-- CreateIndex
CREATE INDEX "employment_contracts_user_id_status_idx" ON "employment_contracts"("user_id", "status");

-- AddForeignKey
ALTER TABLE "site_holidays" ADD CONSTRAINT "site_holidays_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_sign_tokens" ADD CONSTRAINT "site_sign_tokens_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_contracts" ADD CONSTRAINT "employment_contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_settings" ADD CONSTRAINT "user_notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_evaluations" ADD CONSTRAINT "trainee_evaluations_trainee_id_fkey" FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainee_evaluations" ADD CONSTRAINT "trainee_evaluations_writer_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
