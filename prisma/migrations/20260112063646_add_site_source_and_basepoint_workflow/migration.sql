-- CreateEnum
CREATE TYPE "SiteSourceType" AS ENUM ('KEAD', 'AGENCY');

-- CreateEnum
CREATE TYPE "BasePointApprovalStatus" AS ENUM ('ORIGINAL_SET', 'COACH_PROPOSED', 'APPROVED', 'REJECTED', 'CORRECTION_REQUESTED');

-- CreateEnum
CREATE TYPE "ApprovalAuthorityType" AS ENUM ('AGENCY', 'KEAD');

-- AlterTable
ALTER TABLE "sites" ADD COLUMN     "basePointApprovalStatus" "BasePointApprovalStatus" NOT NULL DEFAULT 'ORIGINAL_SET',
ADD COLUMN     "basePointAuthority" "ApprovalAuthorityType" NOT NULL DEFAULT 'AGENCY',
ADD COLUMN     "basePointProposedAt" TIMESTAMP(3),
ADD COLUMN     "basePointProposedByUserId" BIGINT,
ADD COLUMN     "basePointProposedLat" DECIMAL(65,30),
ADD COLUMN     "basePointProposedLon" DECIMAL(65,30),
ADD COLUMN     "siteSourceTyp" "SiteSourceType" NOT NULL DEFAULT 'AGENCY';
