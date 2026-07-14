-- 프리랜서(EXTERNAL+BUSINESS) 야간작업 단가(원/시간) 수기 참조 필드. null=미설정.
-- 노무사 지침: 프리랜서 법정 야간가산 자동적용 금지 → 계약 시 단가 수기 약정·급여 확정 시 수기 반영. 급여엔진 미사용.
-- AlterTable
ALTER TABLE "pay_contracts" ADD COLUMN     "night_rate" DECIMAL(65,30);
