-- AlterTable
-- 9차#3: 워커가 아는 비밀번호 보유 여부. 기본 true(안전) — admin/contracts 초대(랜덤 비번)만 false로 설정된다.
ALTER TABLE "workers" ADD COLUMN     "has_known_password" BOOLEAN NOT NULL DEFAULT true;
