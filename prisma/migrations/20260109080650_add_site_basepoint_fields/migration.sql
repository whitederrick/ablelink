/*
  Warnings:

  - You are about to drop the column `noFieldTraining` on the `sites` table. All the data in the column will be lost.
  - You are about to drop the column `noPreTraining` on the `sites` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sites" DROP COLUMN "noFieldTraining",
DROP COLUMN "noPreTraining",
ADD COLUMN     "base_point_accuracy_m" DOUBLE PRECISION,
ADD COLUMN     "base_point_confirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "base_point_memo" TEXT,
ADD COLUMN     "base_point_source" TEXT,
ADD COLUMN     "base_point_updated_at" TIMESTAMP(3),
ADD COLUMN     "no_field_training" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "no_pre_training" BOOLEAN NOT NULL DEFAULT false;
