-- v7.2 工作包 4：主动抓取执行器数据模型
-- 扩展 sources（抓取策略/条件请求/来源健康），新增 crawl_runs 与 source_documents。

-- 1. 扩展 sources
ALTER TABLE "sources"
    ADD COLUMN     "adapter_key" TEXT,
    ADD COLUMN     "list_urls" JSONB,
    ADD COLUMN     "allowed_hosts" JSONB,
    ADD COLUMN     "poll_every_minutes" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN     "next_check_at" TIMESTAMP(3),
    ADD COLUMN     "cursor" JSONB,
    ADD COLUMN     "etag" TEXT,
    ADD COLUMN     "last_modified" TEXT,
    ADD COLUMN     "health_status" TEXT NOT NULL DEFAULT 'healthy',
    ADD COLUMN     "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN     "last_checked_at" TIMESTAMP(3);

-- 2. 抓取运行审计（业务事实，不能由 BullMQ 任务记录替代）
CREATE TABLE "crawl_runs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "discovered_count" INTEGER NOT NULL DEFAULT 0,
    "downloaded_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_summary" TEXT,
    "adapter_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crawl_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "crawl_runs_source_id_started_at_idx" ON "crawl_runs"("source_id", "started_at");
CREATE INDEX "crawl_runs_status_idx" ON "crawl_runs"("status");

ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. 逻辑官方文档（同一 URL 内容更新只产生新快照，不产生新文档身份）
CREATE TABLE "source_documents" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "canonical_url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'announcement',
    "parent_document_id" TEXT,
    "relation_type" TEXT,
    "content_hash" TEXT,
    "latest_snapshot_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_documents_source_id_canonical_url_key" ON "source_documents"("source_id", "canonical_url");
CREATE INDEX "source_documents_source_id_kind_idx" ON "source_documents"("source_id", "kind");

ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
