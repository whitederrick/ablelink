/*
  Warnings:

  - You are about to drop the `submission_requests` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `submissions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "submission_requests" DROP CONSTRAINT "submission_requests_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "submission_requests" DROP CONSTRAINT "submission_requests_requested_by_manager_id_fkey";

-- DropForeignKey
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_request_id_fkey";

-- DropForeignKey
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_submitted_by_worker_id_fkey";

-- DropTable
DROP TABLE "submission_requests";

-- DropTable
DROP TABLE "submissions";

-- DropEnum
DROP TYPE "SubmissionRequestStatus";
