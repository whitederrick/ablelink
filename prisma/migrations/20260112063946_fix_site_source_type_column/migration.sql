/*
  Warnings:

  - You are about to drop the column `siteSourceTyp` on the `sites` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sites" DROP COLUMN "siteSourceTyp",
ADD COLUMN     "basePointCorrectionReason" TEXT,
ADD COLUMN     "basePointDecidedAt" TIMESTAMP(3),
ADD COLUMN     "basePointDecidedById" BIGINT,
ADD COLUMN     "basePointDecisionMemo" TEXT,
ADD COLUMN     "siteSourceType" "SiteSourceType" NOT NULL DEFAULT 'AGENCY';
