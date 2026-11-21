-- W1/W2：学科审核、官方材料版本、切分、索引任务。
-- pgvector 为可选增强：CI/默认 postgres 镜像没有扩展时自动降级为 Float[] 应用余弦，
-- 迁移不得因扩展缺失而失败（真实向量检索必须在具备扩展的环境复测）。

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector unavailable, fallback to float array: %', SQLERRM;
  END;
END $$;

CREATE TABLE IF NOT EXISTS "subject_alias_reviews" (
  "id" UUID PRIMARY KEY,
  "raw_name" TEXT NOT NULL,
  "stage" TEXT,
  "region_code" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "resolved_code" TEXT,
  "note" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS "subject_alias_reviews_status_created_at_idx"
  ON "subject_alias_reviews" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "knowledge_documents" (
  "id" UUID PRIMARY KEY,
  "title" TEXT NOT NULL,
  "document_type" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "announcement_id" TEXT,
  "announcement_version_id" TEXT,
  "region_code" TEXT,
  "province_code" TEXT,
  "year" INTEGER,
  "publisher" TEXT,
  "official_url" TEXT,
  "effective_from" TIMESTAMPTZ,
  "effective_to" TIMESTAMPTZ,
  "current_version_id" UUID,
  "active_index_version" INTEGER,
  "created_by" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "knowledge_documents_announcement_id_idx"
  ON "knowledge_documents" ("announcement_id");
CREATE INDEX IF NOT EXISTS "knowledge_documents_type_region_status_idx"
  ON "knowledge_documents" ("document_type", "region_code", "status");

CREATE TABLE IF NOT EXISTS "knowledge_document_versions" (
  "id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
  "version_number" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "content_hash" TEXT NOT NULL,
  "parser_version" TEXT NOT NULL,
  "chunker_version" TEXT NOT NULL,
  "snapshot_id" TEXT,
  "storage_key" TEXT,
  "mime_type" TEXT,
  "source_url" TEXT,
  "unit_ids" JSONB,
  "source_captured_at" TIMESTAMPTZ,
  "review_note" TEXT,
  "reviewed_by" TEXT,
  "reviewed_at" TIMESTAMPTZ,
  "published_at" TIMESTAMPTZ,
  "withdrawn_at" TIMESTAMPTZ,
  "withdraw_reason" TEXT,
  "active_index_version" INTEGER,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_document_versions_document_id_version_number_key"
  ON "knowledge_document_versions" ("document_id", "version_number");
CREATE INDEX IF NOT EXISTS "knowledge_document_versions_content_hash_idx"
  ON "knowledge_document_versions" ("content_hash");
CREATE INDEX IF NOT EXISTS "knowledge_document_versions_status_idx"
  ON "knowledge_document_versions" ("status");

CREATE TABLE IF NOT EXISTS "knowledge_chunks" (
  "id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL,
  "version_id" UUID NOT NULL REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE,
  "index_version" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "heading_path" JSONB,
  "locator" JSONB NOT NULL,
  "spans" JSONB,
  "unit_ids" JSONB,
  "char_count" INTEGER NOT NULL,
  "embedding_model" TEXT,
  "embedding_dim" INTEGER,
  "embedding" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_chunks_version_index_chunk_key"
  ON "knowledge_chunks" ("version_id", "index_version", "chunk_index");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_document_index_idx"
  ON "knowledge_chunks" ("document_id", "index_version");

CREATE TABLE IF NOT EXISTS "knowledge_index_jobs" (
  "id" UUID PRIMARY KEY,
  "document_id" UUID NOT NULL,
  "version_id" UUID NOT NULL REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE,
  "idempotency_key" TEXT NOT NULL,
  "index_version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error_class" TEXT,
  "error_message" TEXT,
  "chunk_count" INTEGER NOT NULL DEFAULT 0,
  "embedded_count" INTEGER NOT NULL DEFAULT 0,
  "embedding_model" TEXT,
  "embedding_dim" INTEGER,
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_index_jobs_idempotency_key_key"
  ON "knowledge_index_jobs" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "knowledge_index_jobs_status_created_at_idx"
  ON "knowledge_index_jobs" ("status", "created_at");

-- 可选 pgvector 表：扩展可用时建立，用于精确/近似余弦检索；失败只记录，不阻断迁移。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    BEGIN
      CREATE TABLE IF NOT EXISTS "knowledge_chunk_vectors" (
        "chunk_id" UUID PRIMARY KEY REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE,
        "embedding" vector(1024) NOT NULL,
        "model" TEXT NOT NULL,
        "dim" INTEGER NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "knowledge_chunk_vectors_hnsw_idx"
        ON "knowledge_chunk_vectors" USING hnsw ("embedding" vector_cosine_ops);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pgvector vector table/index unavailable: %', SQLERRM;
    END;
  END IF;
END $$;
