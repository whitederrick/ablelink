/*
  Warnings:

  - You are about to drop the `system_audit_logs` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "system_audit_logs" DROP CONSTRAINT "system_audit_logs_admin_id_fkey";

-- DropTable
DROP TABLE "system_audit_logs";
