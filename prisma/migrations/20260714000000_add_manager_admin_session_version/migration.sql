-- #5(17차): 매니저·운영자 세션 무효화 버전(비번 초기화 시 +1 → 탈취 세션 회수). 워커와 동일 패턴.
-- @default(0) NOT NULL → sv 미포함 구 토큰(=0)과 기존 계정(백필 0) 하위호환. 배포 시 강제 로그아웃 없음.
-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "managers" ADD COLUMN     "session_version" INTEGER NOT NULL DEFAULT 0;
