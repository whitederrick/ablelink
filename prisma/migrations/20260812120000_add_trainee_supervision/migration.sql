-- 직무지도원 전담(TraineeSupervision) 신설 — D-1 §2.
-- 문서 접근권을 "훈련생 소유"가 아니라 관여 사실에서 파생시키기 위한 도메인 관계다:
--   배정(site_assignments) ∩ 재적(trainee_placements) ∩ 담당(trainee_supervisions) ∩ 요청기간
-- 배정·재적만으로는 같은 사업체에 직무지도원이 2명일 때 누가 어느 훈련생을 담당하는지 구분할 수 없다.
--
-- 순수 신규 테이블 — 기존 행·기존 조회에 영향 없음(읽는 코드가 아직 없다).
-- worker_id/site_id/agency_id는 중복 저장하지 않는다(assignment/placement에서 파생).
-- 기간 겹침 금지(같은 훈련생)는 애플리케이션 검증 + 훈련생 단위 advisory lock(NS=4)으로 강제한다.
-- DB exclusion constraint는 Prisma drift·운영 복잡성 때문에 1차 범위에서 제외했다(후속 심층방어).

CREATE TABLE "trainee_supervisions" (
    "id" BIGSERIAL NOT NULL,
    "trainee_id" BIGINT NOT NULL,
    "placement_id" BIGINT NOT NULL,
    "assignment_id" BIGINT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainee_supervisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trainee_supervisions_trainee_id_start_date_end_date_idx"
    ON "trainee_supervisions"("trainee_id", "start_date", "end_date");

CREATE INDEX "trainee_supervisions_assignment_id_start_date_end_date_idx"
    ON "trainee_supervisions"("assignment_id", "start_date", "end_date");

CREATE INDEX "trainee_supervisions_placement_id_idx"
    ON "trainee_supervisions"("placement_id");

ALTER TABLE "trainee_supervisions" ADD CONSTRAINT "trainee_supervisions_trainee_id_fkey"
    FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trainee_supervisions" ADD CONSTRAINT "trainee_supervisions_placement_id_fkey"
    FOREIGN KEY ("placement_id") REFERENCES "trainee_placements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "trainee_supervisions" ADD CONSTRAINT "trainee_supervisions_assignment_id_fkey"
    FOREIGN KEY ("assignment_id") REFERENCES "site_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
