-- AlterTable
-- #7: 맞춤(CUSTOM) 근무형 정원 버킷. 기본 0(=맞춤 불필요). finalize 슬롯별 정원 검사에 사용.
ALTER TABLE "sites" ADD COLUMN     "custom_capacity" INTEGER NOT NULL DEFAULT 0;
