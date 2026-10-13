-- v7.2 附件解析：文档格式解析运行（DocumentParseRun）
-- 字节 → 标准文档 的独立留痕表；业务字段抽取仍走 extraction_runs（技术方案 §8.4）。

CREATE TABLE "document_parse_runs" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "document_id" TEXT,
    "format" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "blocks" JSONB,
    "table_headers" JSONB,
    "block_count" INTEGER NOT NULL DEFAULT 0,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "error_summary" TEXT,
    "scanned" BOOLEAN NOT NULL DEFAULT false,
    "ocr_required" BOOLEAN NOT NULL DEFAULT false,
    "ocr_status" TEXT,
    "source_url" TEXT,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "document_parse_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_parse_runs_idempotency_key_key" ON "document_parse_runs"("idempotency_key");
CREATE UNIQUE INDEX "document_parse_runs_snapshot_id_parser_version_key" ON "document_parse_runs"("snapshot_id", "parser_version");
CREATE INDEX "document_parse_runs_status_idx" ON "document_parse_runs"("status");
CREATE INDEX "document_parse_runs_snapshot_id_idx" ON "document_parse_runs"("snapshot_id");

ALTER TABLE "document_parse_runs" ADD CONSTRAINT "document_parse_runs_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "source_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
