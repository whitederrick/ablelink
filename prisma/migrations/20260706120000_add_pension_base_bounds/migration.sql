-- AlterTable: 국민연금 기준소득월액 하한액/상한액(원). null이면 종전 근사 유지.
ALTER TABLE "insurance_rates" ADD COLUMN     "pension_base_min" DECIMAL(65,30);
ALTER TABLE "insurance_rates" ADD COLUMN     "pension_base_max" DECIMAL(65,30);
