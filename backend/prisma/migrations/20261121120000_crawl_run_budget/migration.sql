-- 手动试跑预算（2026-11-21）
-- 增量、可重复执行；只在带预算的手动运行上建行，常规调度不受影响。

CREATE TABLE IF NOT EXISTS "crawl_run_budgets" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "max_list_pages" INTEGER NOT NULL,
  "max_details" INTEGER NOT NULL,
  "max_attachments_per_document" INTEGER NOT NULL,
  "max_attachments_total" INTEGER NOT NULL,
  "max_http_requests" INTEGER NOT NULL,
  "list_pages_used" INTEGER NOT NULL DEFAULT 0,
  "details_used" INTEGER NOT NULL DEFAULT 0,
  "attachments_used" INTEGER NOT NULL DEFAULT 0,
  "http_requests_used" INTEGER NOT NULL DEFAULT 0,
  "list_pages_deferred" INTEGER NOT NULL DEFAULT 0,
  "details_deferred" INTEGER NOT NULL DEFAULT 0,
  "attachments_deferred" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "stop_reason" TEXT,
  "stopped_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "crawl_run_budgets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crawl_run_budgets_run_id_key" ON "crawl_run_budgets"("run_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'crawl_run_budgets_run_id_fkey'
  ) THEN
    ALTER TABLE "crawl_run_budgets"
      ADD CONSTRAINT "crawl_run_budgets_run_id_fkey"
      FOREIGN KEY ("run_id") REFERENCES "crawl_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "crawl_run_admissions" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "canonical_url" TEXT NOT NULL,
  "parent_document_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "crawl_run_admissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "crawl_run_admissions_run_id_kind_canonical_url_key"
  ON "crawl_run_admissions"("run_id", "kind", "canonical_url");

CREATE INDEX IF NOT EXISTS "crawl_run_admissions_run_id_kind_parent_document_id_idx"
  ON "crawl_run_admissions"("run_id", "kind", "parent_document_id");
