-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'GOV', 'AGENCY');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" BIGSERIAL NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "displayName" TEXT,
    "agencyName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_loginId_key" ON "AdminUser"("loginId");

-- CreateIndex
CREATE INDEX "AdminUser_role_idx" ON "AdminUser"("role");

-- CreateIndex
CREATE INDEX "AdminUser_agencyName_idx" ON "AdminUser"("agencyName");
