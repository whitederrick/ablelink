-- 운영자 등급 단위 개통(2026-06-06): PlanType에 STARTER/STANDARD/PRO 추가.
-- 개인(직무지도원)에게 특정 구독 등급만 부여할 수 있게 한다. 추가형(무손실).
-- PG12+에서 ALTER TYPE ADD VALUE는 트랜잭션 내 실행 가능(같은 트랜잭션에서 사용만 안 하면 됨).
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'STARTER';
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'STANDARD';
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'PRO';
