-- W5：政策检索适用范围与有效期（可重复执行，不批量改写旧数据）

ALTER TABLE "knowledge_documents"
  ADD COLUMN IF NOT EXISTS "applicable_audience" TEXT,
  ADD COLUMN IF NOT EXISTS "applicable_subjects" JSONB,
  ADD COLUMN IF NOT EXISTS "applicable_stages" JSONB;

ALTER TABLE "qa_answers"
  ADD COLUMN IF NOT EXISTS "year" INTEGER;

CREATE INDEX IF NOT EXISTS "knowledge_documents_document_type_region_code_year_status_idx"
  ON "knowledge_documents" ("document_type", "region_code", "year", "status");
