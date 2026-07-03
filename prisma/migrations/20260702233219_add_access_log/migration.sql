-- CreateTable
CREATE TABLE "access_logs" (
    "id" BIGSERIAL NOT NULL,
    "agency_id" BIGINT,
    "actor_type" "ActorType" NOT NULL,
    "actor_id" BIGINT,
    "actor_label" TEXT,
    "ip" TEXT,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "subject_label" TEXT,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "path" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_logs_agency_id_created_at_idx" ON "access_logs"("agency_id", "created_at");

-- CreateIndex
CREATE INDEX "access_logs_actor_type_actor_id_idx" ON "access_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "access_logs_subject_type_subject_id_idx" ON "access_logs"("subject_type", "subject_id");

-- CreateIndex
CREATE INDEX "access_logs_created_at_idx" ON "access_logs"("created_at");
