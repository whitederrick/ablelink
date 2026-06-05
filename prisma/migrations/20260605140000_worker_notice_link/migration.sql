-- 워커 알림 바로가기(deep-link). 처리필요 요청 알림이 해당 화면으로 이동하도록. 추가형 nullable.
ALTER TABLE "worker_notices" ADD COLUMN "link" TEXT;
