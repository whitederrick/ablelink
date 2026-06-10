-- 운영자 조정 시스템 파라미터(하드코딩 지양)
CREATE TABLE "system_configs" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_configs_pkey" PRIMARY KEY ("key")
);
