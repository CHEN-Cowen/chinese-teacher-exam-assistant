-- M02/F3：采集运行告警（重启不丢的运行事实）
-- 活跃告警 = resolved_at 为空；重复发生仅累加 occurrences。
-- (type, source_id) 唯一：来源级告警每来源每类型一行；
-- 全局告警（worker_down）source_id 为空，PostgreSQL 对 NULL 不去重，
-- 由服务层以 type='worker_down' AND source_id IS NULL 条件 upsert 兜底。

CREATE TABLE "sourcing_alerts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "source_id" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "message" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sourcing_alerts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sourcing_alerts"
  ADD CONSTRAINT "sourcing_alerts_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "sourcing_alerts_type_source_id_key"
  ON "sourcing_alerts"("type", "source_id");

CREATE INDEX "sourcing_alerts_resolved_at_last_seen_at_idx"
  ON "sourcing_alerts"("resolved_at", "last_seen_at");
