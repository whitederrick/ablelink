-- CreateEnum
CREATE TYPE "PilotResourceKind" AS ENUM ('AGENCY', 'SITE', 'TRAINEE', 'PLACEMENT', 'WORKER', 'ASSIGNMENT', 'STORAGE_OBJECT');

-- CreateTable
CREATE TABLE "pilots" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_resources" (
    "id" BIGSERIAL NOT NULL,
    "pilot_id" BIGINT NOT NULL,
    "kind" "PilotResourceKind" NOT NULL,
    "resource_key" TEXT NOT NULL,
    "delete_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pilot_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pilot_resources_pilot_id_kind_idx" ON "pilot_resources"("pilot_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "pilot_resources_kind_resource_key_key" ON "pilot_resources"("kind", "resource_key");

-- AddForeignKey
ALTER TABLE "pilot_resources" ADD CONSTRAINT "pilot_resources_pilot_id_fkey" FOREIGN KEY ("pilot_id") REFERENCES "pilots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
