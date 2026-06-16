-- 근로계약서 양식(템플릿) 선택 지원
ALTER TABLE "employment_contracts" ADD COLUMN "template_key" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "employment_contracts" ADD COLUMN "template_data" JSONB;
ALTER TABLE "agencies" ADD COLUMN "default_contract_template" TEXT;
