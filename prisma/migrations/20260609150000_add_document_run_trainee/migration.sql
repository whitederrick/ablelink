-- 문서 허브: 일지·평가 등 훈련생 단위 문서 구분을 위해 DocumentRun에 trainee_id 추가.
-- unique 키를 (assignment, docType, periodStart, traineeId)로 확장(출근부 등은 traineeId=null).
ALTER TABLE "document_runs" ADD COLUMN "trainee_id" BIGINT;

DROP INDEX IF EXISTS "document_runs_assignment_id_doc_type_period_start_key";

CREATE UNIQUE INDEX "document_runs_assignment_id_doc_type_period_start_trainee_id_key"
  ON "document_runs"("assignment_id", "doc_type", "period_start", "trainee_id");
