-- CreateEnum
CREATE TYPE "CoachType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- AlterTable
ALTER TABLE "pay_contracts" ADD COLUMN     "coach_type" "CoachType" NOT NULL DEFAULT 'EXTERNAL';
