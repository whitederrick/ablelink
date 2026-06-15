-- 직무지도원 활동(휴면) 상태 판정용: 마지막 로그인 시각
ALTER TABLE "workers" ADD COLUMN "last_login_at" TIMESTAMP(3);
