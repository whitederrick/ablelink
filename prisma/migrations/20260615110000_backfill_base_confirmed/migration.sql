-- 위치확정 게이트 하위호환 백필 (assignment-pipeline-design.md §8)
-- 게이트(clock-in이 base_confirmed_at 필요)를 도입하면 기존 운영 중인 ACTIVE 배정이 차단된다.
-- 이미 기준점이 확정된(base_point_confirmed=true) 현장의 ACTIVE 배정은 grandfather 처리하여
-- base_confirmed_at을 확정 시점(없으면 now)으로 백필한다. 신규 배정은 게이트를 정상 통과해야 함.
UPDATE "site_assignments" sa
SET "base_confirmed_at" = COALESCE(s."base_point_updated_at", NOW())
FROM "sites" s
WHERE sa."site_id" = s."id"
  AND sa."status" = 'ACTIVE'
  AND sa."base_confirmed_at" IS NULL
  AND s."base_point_confirmed" = true;
