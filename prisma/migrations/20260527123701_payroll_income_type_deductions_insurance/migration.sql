-- CreateEnum
CREATE TYPE "IncomeType" AS ENUM ('BUSINESS', 'EMPLOYMENT');

-- CreateEnum
CREATE TYPE "DeductionType" AS ENUM ('FIXED', 'PERCENTAGE');

-- AlterTable
ALTER TABLE "pay_contracts" ADD COLUMN     "hourly_rate_2plus" DECIMAL(65,30),
ADD COLUMN     "income_type" "IncomeType" NOT NULL DEFAULT 'BUSINESS',
ADD COLUMN     "weekly_holiday_pay" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "agency_deductions" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeductionType" NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_deductions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_rates" (
    "id" BIGSERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "national_pension" DECIMAL(65,30) NOT NULL,
    "health_insurance" DECIMAL(65,30) NOT NULL,
    "long_term_care" DECIMAL(65,30) NOT NULL,
    "employment_insurance" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "insurance_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_deductions_agency_id_is_active_idx" ON "agency_deductions"("agency_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_rates_year_key" ON "insurance_rates"("year");

-- AddForeignKey
ALTER TABLE "agency_deductions" ADD CONSTRAINT "agency_deductions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
