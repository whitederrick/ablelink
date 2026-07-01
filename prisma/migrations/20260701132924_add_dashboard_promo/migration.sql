-- CreateEnum
CREATE TYPE "DashboardPromoKind" AS ENUM ('TICKER', 'AD');

-- CreateTable
CREATE TABLE "dashboard_promos" (
    "id" BIGSERIAL NOT NULL,
    "kind" "DashboardPromoKind" NOT NULL,
    "badge" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "image_url" TEXT,
    "href" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "note" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_promos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dashboard_promos_kind_is_active_sort_order_idx" ON "dashboard_promos"("kind", "is_active", "sort_order");

