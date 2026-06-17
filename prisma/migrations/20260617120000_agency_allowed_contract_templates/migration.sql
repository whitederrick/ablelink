-- 위탁기관 전용 계약서 양식 부여 목록(운영자가 부여). 전체 공용 양식(STANDARD)은 이 목록과 무관하게 사용 가능.
ALTER TABLE "agencies" ADD COLUMN "allowed_contract_templates" TEXT[] NOT NULL DEFAULT '{}';
