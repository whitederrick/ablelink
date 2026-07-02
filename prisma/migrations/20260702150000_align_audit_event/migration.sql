-- 07-02 db push 로 반영된 audit_events(감사로그) 재설계를 마이그레이션 이력에 정합화한다.
-- 운영/개발 DB는 이미 아래 최종 형태를 가지고 있으므로(운영은 resolve --applied 로 표시),
-- 이 마이그는 fresh 빌드(migrate reset/deploy) 시 init 의 구형 audit_events → 최종형으로 변환한다.

-- 1) ActorType enum 재작성: ('ADMIN','USER','SITE_CONTACT') → ('ADMIN','MANAGER','WORKER','SYSTEM')
ALTER TYPE "ActorType" RENAME TO "ActorType_old";
CREATE TYPE "ActorType" AS ENUM ('ADMIN', 'MANAGER', 'WORKER', 'SYSTEM');
ALTER TABLE "audit_events" ALTER COLUMN "actor_type" TYPE "ActorType" USING ("actor_type"::text::"ActorType");
DROP TYPE "ActorType_old";

-- 2) audit_events 컬럼/인덱스 재설계
--    entity_type: EntityType enum → TEXT(모델명), entity_id: BIGINT → TEXT, + actor_label, + summary
DROP INDEX "audit_events_agency_id_entity_type_entity_id_idx";
ALTER TABLE "audit_events" ADD COLUMN "actor_label" TEXT;
ALTER TABLE "audit_events" ADD COLUMN "summary" TEXT;
ALTER TABLE "audit_events" ALTER COLUMN "entity_type" TYPE TEXT USING "entity_type"::text;
ALTER TABLE "audit_events" ALTER COLUMN "entity_id" TYPE TEXT USING "entity_id"::text;
CREATE INDEX "audit_events_agency_id_entity_type_created_at_idx" ON "audit_events"("agency_id", "entity_type", "created_at");
CREATE INDEX "audit_events_created_at_idx" ON "audit_events"("created_at");

-- 3) 미사용 EntityType enum 제거
DROP TYPE "EntityType";
