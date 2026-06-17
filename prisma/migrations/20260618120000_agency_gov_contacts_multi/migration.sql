-- 장애인고용공단 담당자 복수 입력 지원: [{ name, email }] JSON 배열
ALTER TABLE "agencies" ADD COLUMN "gov_contacts" JSONB;

-- 기존 단일 담당자(gov_contact_name/email)를 첫 번째 항목으로 백필
UPDATE "agencies"
SET "gov_contacts" = jsonb_build_array(
  jsonb_build_object('name', COALESCE("gov_contact_name", ''), 'email', "gov_contact_email")
)
WHERE "gov_contact_email" IS NOT NULL AND "gov_contact_email" <> '';
