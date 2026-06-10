-- 근로계약서 사업주 대표자명 + 직무지도원 급여계좌(통장사본) 필드
-- Agency: 계약서 사업주(갑) 자동입력용 대표자명
ALTER TABLE "agencies" ADD COLUMN "representative_name" TEXT;

-- Worker: 급여 이체용 계좌/통장사본 (셀프 입력 + 관리자 조회)
ALTER TABLE "workers" ADD COLUMN "bank_name" TEXT;
ALTER TABLE "workers" ADD COLUMN "account_number" TEXT;
ALTER TABLE "workers" ADD COLUMN "account_holder" TEXT;
ALTER TABLE "workers" ADD COLUMN "passbook_image_url" TEXT;
