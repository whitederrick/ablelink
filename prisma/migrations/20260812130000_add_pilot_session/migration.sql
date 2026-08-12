-- 파일럿 회차 메타데이터 — docs/PILOT_DESIGN_2026_08_12_v1_8.md §4·§5·§11.
-- 도메인 관계(TraineeSupervision) 마이그레이션과 분리한다 — 장애·롤백 범위가 다르다.
--
-- ★파일럿 여부를 기관·기간으로 추론하지 않는다. 같은 실재 기관이 정상 운영을 병행할 수 있으므로
--  회차 id로만 명시 구분한다. 기관 엔티티에는 파일럿 플래그를 붙이지 않는다.
--
-- 기존 데이터 영향: worker_invites.created_by_manager_id의 NOT NULL 해제 1건 외에는 전부 신규다.
-- 기존 행은 created_by_manager_id가 이미 채워져 있어 XOR CHECK를 그대로 통과한다.

CREATE TYPE "PilotSessionStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'ENDED', 'PURGED', 'CANCELLED');
CREATE TYPE "PilotParticipantStatus" AS ENUM ('CONFIGURED', 'INVITED', 'ACCEPTED', 'CANCELLED');

-- ── 회차 ────────────────────────────────────────────────────────────
CREATE TABLE "pilot_sessions" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "manager_display_name" TEXT,
    "status" "PilotSessionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_admin_id" BIGINT NOT NULL,
    "activated_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pilot_sessions_status_start_date_end_date_idx"
    ON "pilot_sessions"("status", "start_date", "end_date");
CREATE INDEX "pilot_sessions_agency_id_status_idx"
    ON "pilot_sessions"("agency_id", "status");

-- ★한 시점에 ACTIVE 회차는 전역 1개(v1.8 §4).
--  상수식 인덱스라 status='ACTIVE'인 행이 둘이면 두 번째 삽입이 거부된다.
--  애플리케이션 advisory lock이 정상 경합을 처리하고, 이 인덱스는 비정상 경로·코드 누락에 대한
--  최종 불변식 방어다(락은 unique constraint를 대체하지 않는다).
CREATE UNIQUE INDEX "pilot_sessions_one_active"
    ON "pilot_sessions" ((1)) WHERE "status" = 'ACTIVE';

ALTER TABLE "pilot_sessions" ADD CONSTRAINT "pilot_sessions_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pilot_sessions" ADD CONSTRAINT "pilot_sessions_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 참여자 ──────────────────────────────────────────────────────────
CREATE TABLE "pilot_participants" (
    "id" BIGSERIAL NOT NULL,
    "pilot_session_id" BIGINT NOT NULL,
    "worker_id" BIGINT,
    "invite_id" BIGINT,
    "site_id" BIGINT,
    "status" "PilotParticipantStatus" NOT NULL DEFAULT 'CONFIGURED',
    "assignment_start_date" DATE NOT NULL,
    "assignment_end_date" DATE NOT NULL,
    "service_step" "ServiceStep" NOT NULL,
    "work_type" TEXT NOT NULL,
    "commute_guidance_included" BOOLEAN NOT NULL DEFAULT true,
    "custom_work_start" TEXT,
    "custom_work_end" TEXT,
    "attendance_mode" "AttendanceMode" NOT NULL DEFAULT 'NONE',
    "attendance_button_exempt" BOOLEAN NOT NULL DEFAULT true,
    "created_assignment_id" BIGINT,
    "accepted_at" TIMESTAMP(3),
    "purged_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pilot_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pilot_participants_invite_id_key" ON "pilot_participants"("invite_id");
CREATE UNIQUE INDEX "pilot_participants_created_assignment_id_key" ON "pilot_participants"("created_assignment_id");
-- 같은 회차에 같은 Worker 중복 참여 금지. worker_id=NULL(신규 대기)은 NULL이 구분값이라 공존한다.
CREATE UNIQUE INDEX "pilot_participants_pilot_session_id_worker_id_key"
    ON "pilot_participants"("pilot_session_id", "worker_id");
CREATE INDEX "pilot_participants_pilot_session_id_status_idx"
    ON "pilot_participants"("pilot_session_id", "status");

ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_pilot_session_id_fkey"
    FOREIGN KEY ("pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_worker_id_fkey"
    FOREIGN KEY ("worker_id") REFERENCES "workers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_invite_id_fkey"
    FOREIGN KEY ("invite_id") REFERENCES "worker_invites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_site_id_fkey"
    FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pilot_participants" ADD CONSTRAINT "pilot_participants_created_assignment_id_fkey"
    FOREIGN KEY ("created_assignment_id") REFERENCES "site_assignments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 참여자-훈련생 조인 ──────────────────────────────────────────────
CREATE TABLE "pilot_participant_trainees" (
    "id" BIGSERIAL NOT NULL,
    "participant_id" BIGINT NOT NULL,
    "trainee_id" BIGINT NOT NULL,

    CONSTRAINT "pilot_participant_trainees_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pilot_participant_trainees_participant_id_trainee_id_key"
    ON "pilot_participant_trainees"("participant_id", "trainee_id");
CREATE INDEX "pilot_participant_trainees_trainee_id_idx"
    ON "pilot_participant_trainees"("trainee_id");

ALTER TABLE "pilot_participant_trainees" ADD CONSTRAINT "pilot_participant_trainees_participant_id_fkey"
    FOREIGN KEY ("participant_id") REFERENCES "pilot_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pilot_participant_trainees" ADD CONSTRAINT "pilot_participant_trainees_trainee_id_fkey"
    FOREIGN KEY ("trainee_id") REFERENCES "trainees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── 회차 참여 FK (운영 데이터에 회차를 명시 기록) ───────────────────
ALTER TABLE "site_assignments"     ADD COLUMN "pilot_session_id" BIGINT;
ALTER TABLE "trainee_placements"   ADD COLUMN "pilot_session_id" BIGINT;
ALTER TABLE "trainee_supervisions" ADD COLUMN "pilot_session_id" BIGINT;

CREATE INDEX "site_assignments_pilot_session_id_idx"     ON "site_assignments"("pilot_session_id");
CREATE INDEX "trainee_placements_pilot_session_id_idx"   ON "trainee_placements"("pilot_session_id");
CREATE INDEX "trainee_supervisions_pilot_session_id_idx" ON "trainee_supervisions"("pilot_session_id");

ALTER TABLE "site_assignments" ADD CONSTRAINT "site_assignments_pilot_session_id_fkey"
    FOREIGN KEY ("pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trainee_placements" ADD CONSTRAINT "trainee_placements_pilot_session_id_fkey"
    FOREIGN KEY ("pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trainee_supervisions" ADD CONSTRAINT "trainee_supervisions_pilot_session_id_fkey"
    FOREIGN KEY ("pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 회차가 새로 만든 공유 자원 (폐기 판정용 — 참여와 의미가 다르다) ──
ALTER TABLE "sites"    ADD COLUMN "created_by_pilot_session_id" BIGINT;
ALTER TABLE "trainees" ADD COLUMN "created_by_pilot_session_id" BIGINT;
ALTER TABLE "workers"  ADD COLUMN "created_by_pilot_session_id" BIGINT;

CREATE INDEX "sites_created_by_pilot_session_id_idx"    ON "sites"("created_by_pilot_session_id");
CREATE INDEX "trainees_created_by_pilot_session_id_idx" ON "trainees"("created_by_pilot_session_id");
CREATE INDEX "workers_created_by_pilot_session_id_idx"  ON "workers"("created_by_pilot_session_id");

ALTER TABLE "sites" ADD CONSTRAINT "sites_created_by_pilot_session_id_fkey"
    FOREIGN KEY ("created_by_pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trainees" ADD CONSTRAINT "trainees_created_by_pilot_session_id_fkey"
    FOREIGN KEY ("created_by_pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workers" ADD CONSTRAINT "workers_created_by_pilot_session_id_fkey"
    FOREIGN KEY ("created_by_pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 초대 확장 (운영자 발급 + 회차 귀속) ─────────────────────────────
-- 파일럿에는 위탁기관 담당자(Manager) 계정이 없으므로 운영자가 초대를 발급해야 한다.
-- 기존 초대 경로는 created_by_manager_id만 채우므로 동작이 바뀌지 않는다.
ALTER TABLE "worker_invites" ALTER COLUMN "created_by_manager_id" DROP NOT NULL;
ALTER TABLE "worker_invites" ADD COLUMN "created_by_admin_id" BIGINT;
ALTER TABLE "worker_invites" ADD COLUMN "pilot_session_id" BIGINT;

CREATE INDEX "worker_invites_pilot_session_id_idx" ON "worker_invites"("pilot_session_id");

ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_created_by_admin_id_fkey"
    FOREIGN KEY ("created_by_admin_id") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_pilot_session_id_fkey"
    FOREIGN KEY ("pilot_session_id") REFERENCES "pilot_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ★발급자는 매니저 또는 운영자 중 정확히 하나(XOR).
--  둘 다 NULL이면 발급 주체를 감사할 수 없고, 둘 다 있으면 권한 근거가 모호해진다.
--  기존 행은 created_by_manager_id가 채워져 있어 그대로 통과한다.
ALTER TABLE "worker_invites" ADD CONSTRAINT "worker_invites_creator_xor"
    CHECK (num_nonnulls("created_by_manager_id", "created_by_admin_id") = 1);
