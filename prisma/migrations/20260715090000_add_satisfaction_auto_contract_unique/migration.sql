-- cron §5 계약종료 자동 만족도조사 중복 발송 방어(P3, CODE_REVIEW_FULL_2026_07_08 P2-3).
-- 배치 겹침 실행(재시도·수동 재트리거) 시 findFirst dup 체크 레이스로 같은 계약에 조사 2건+알림톡 2건(유료)이
-- 나가던 것을 DB 수준에서 차단 — 자동발송(auto=true)은 계약당 1건만 허용.
-- ★수동 요청(auto=false: 매니저 admin/surveys·운영자 system/surveys)은 부분 인덱스 조건 밖 = 영향 없음
--   (만료·취소 후 같은 계약 재요청 플로 보존). contract_id IS NULL 행도 조건 밖.
-- ⚠️Prisma 스키마는 partial index 미지원 → schema.prisma 주석으로만 문서화. `db push`/`migrate dev`가
--   이 인덱스를 drop 후보로 잡을 수 있으니 마이그레이션 파일 기반(migrate deploy)으로만 적용할 것.
CREATE UNIQUE INDEX IF NOT EXISTS "satisfaction_surveys_auto_contract_key"
  ON "satisfaction_surveys" ("contract_id")
  WHERE "auto" = true AND "contract_id" IS NOT NULL;
