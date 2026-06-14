-- 직무지도원 배정 파이프라인 게이트 (assignment-pipeline-design.md)
-- connectedAt: 워커가 임시비번 로그인 / 인증코드 입력으로 배정을 본인 계정에 연결한 시각
-- baseConfirmedAt: 최초 현장 위치확정(SiteBasePoint WORKER_FINAL) 시각 — 출근부 개방 게이트
ALTER TABLE "site_assignments"
  ADD COLUMN "connected_at"      TIMESTAMP(3),
  ADD COLUMN "base_confirmed_at" TIMESTAMP(3);
