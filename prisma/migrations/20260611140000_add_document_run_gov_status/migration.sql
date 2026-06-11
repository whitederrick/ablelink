-- 장애인고용공단 제출 상태(공단 제출완료/재제출요구) — signStage와 독립 축
ALTER TABLE "document_runs"
  ADD COLUMN "gov_status" TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN "gov_submitted_at" TIMESTAMP(3);
