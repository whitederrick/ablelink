-- 공단 발송 누적 횟수: 1회=공단 제출 완료, 2회 이상=공단 수정 제출 완료(재발송·n차)
ALTER TABLE "document_runs" ADD COLUMN "gov_submit_count" INTEGER NOT NULL DEFAULT 0;

-- 기존에 이미 공단 제출완료(SUBMITTED)였던 문서는 최소 1회 발송된 것으로 간주
UPDATE "document_runs" SET "gov_submit_count" = 1 WHERE "gov_status" = 'SUBMITTED' AND "gov_submit_count" = 0;
