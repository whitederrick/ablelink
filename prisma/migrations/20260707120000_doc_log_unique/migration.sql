-- 문서/일지 중복 방어 (DB 레벨).
-- 안전: 제약 추가 전에 기존 중복행을 정리(각 키의 최신 id만 유지)한다. 운영에 중복이 있어도 실패하지 않음.

-- ── TraineeLog: (attendance_id, trainee_id) 중복 제거 후 유니크 인덱스 ──
--  한 출근기록(하루)·훈련생당 일지 1건. save/batch-save의 findFirst-then-create 레이스로 중복 생성되던 것 차단.
DELETE FROM "trainee_logs" a
USING "trainee_logs" b
WHERE a."attendance_id" = b."attendance_id"
  AND a."trainee_id" = b."trainee_id"
  AND a."id" < b."id";  -- 각 키의 최신(id 최대)만 남김

CREATE UNIQUE INDEX "trainee_logs_attendance_id_trainee_id_key"
  ON "trainee_logs" ("attendance_id", "trainee_id");

-- ── DocumentRun: 출근부류(trainee_id NULL) 중복 제거 후 부분 유니크 인덱스 ──
--  기존 @@unique(assignment_id, doc_type, period_start, trainee_id)는 Postgres에서 trainee_id=NULL을
--  서로 다른 값으로 취급해 출근부류 중복을 허용한다 → NULL 전용 부분 유니크로 보완.
--  (Prisma 스키마엔 표현 불가한 partial index. migrate deploy로만 적용하며 migrate dev는 사용하지 않음.)
DELETE FROM "document_runs" a
USING "document_runs" b
WHERE a."trainee_id" IS NULL AND b."trainee_id" IS NULL
  AND a."assignment_id" = b."assignment_id"
  AND a."doc_type" = b."doc_type"
  AND a."period_start" = b."period_start"
  AND a."id" < b."id";

CREATE UNIQUE INDEX "document_runs_assignment_doctype_period_null_trainee_key"
  ON "document_runs" ("assignment_id", "doc_type", "period_start")
  WHERE "trainee_id" IS NULL;
