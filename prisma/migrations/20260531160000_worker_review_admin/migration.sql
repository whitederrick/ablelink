-- WorkerReview: 운영자(공단/플랫폼) 평가 주체 + updatedAt

ALTER TABLE "worker_reviews"
    ADD COLUMN "created_by_admin_id" BIGINT,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
