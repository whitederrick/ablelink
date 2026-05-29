-- CreateEnum
CREATE TYPE "HolidayRequestType" AS ENUM ('DELETE', 'CHANGE_WORKDAY');
CREATE TYPE "HolidayRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "site_holiday_requests" (
    "id" BIGSERIAL NOT NULL,
    "holiday_id" BIGINT NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "admin_id" BIGINT,
    "request_type" "HolidayRequestType" NOT NULL,
    "proposed_count_as_workday" BOOLEAN,
    "reason" TEXT,
    "status" "HolidayRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),

    CONSTRAINT "site_holiday_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_holiday_requests_holiday_id_status_idx" ON "site_holiday_requests"("holiday_id", "status");
CREATE INDEX "site_holiday_requests_agency_id_status_idx" ON "site_holiday_requests"("agency_id", "status");

-- AddForeignKey
ALTER TABLE "site_holiday_requests" ADD CONSTRAINT "site_holiday_requests_holiday_id_fkey"
  FOREIGN KEY ("holiday_id") REFERENCES "site_holidays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "site_holiday_requests" ADD CONSTRAINT "site_holiday_requests_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "site_holiday_requests" ADD CONSTRAINT "site_holiday_requests_admin_id_fkey"
  FOREIGN KEY ("admin_id") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
