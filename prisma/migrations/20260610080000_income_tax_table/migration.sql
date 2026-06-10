-- 근로소득 간이세액표(운영자 연도별 관리)
CREATE TABLE "income_tax_tables" (
  "id" BIGSERIAL NOT NULL,
  "year" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  "row_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "income_tax_tables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "income_tax_tables_year_key" ON "income_tax_tables"("year");
