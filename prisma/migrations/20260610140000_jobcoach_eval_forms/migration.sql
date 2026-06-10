-- 직무지도원 평가 질문지 (시스템 운영자 관리)
CREATE TABLE "jobcoach_eval_forms" (
  "id" BIGSERIAL NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "include_opinion" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "jobcoach_eval_forms_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "jobcoach_eval_forms_is_active_idx" ON "jobcoach_eval_forms"("is_active");

CREATE TABLE "jobcoach_eval_categories" (
  "id" BIGSERIAL NOT NULL,
  "form_id" BIGINT NOT NULL,
  "name" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "jobcoach_eval_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "jobcoach_eval_categories_form_id_sort_order_idx" ON "jobcoach_eval_categories"("form_id", "sort_order");

CREATE TABLE "jobcoach_eval_questions" (
  "id" BIGSERIAL NOT NULL,
  "category_id" BIGINT NOT NULL,
  "text" TEXT NOT NULL,
  "max_score" INTEGER NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "jobcoach_eval_questions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "jobcoach_eval_questions_category_id_sort_order_idx" ON "jobcoach_eval_questions"("category_id", "sort_order");

ALTER TABLE "jobcoach_eval_categories" ADD CONSTRAINT "jobcoach_eval_categories_form_id_fkey"
  FOREIGN KEY ("form_id") REFERENCES "jobcoach_eval_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobcoach_eval_questions" ADD CONSTRAINT "jobcoach_eval_questions_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "jobcoach_eval_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
