-- 민감정보 비보관 원칙: 통장사본 이미지 컬럼 제거(수집한 적 없음, 계좌 검증은 예금주 조회로 대체)
ALTER TABLE "workers" DROP COLUMN IF EXISTS "passbook_image_url";
