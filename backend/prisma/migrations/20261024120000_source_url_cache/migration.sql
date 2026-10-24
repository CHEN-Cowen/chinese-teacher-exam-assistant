ALTER TABLE "crawl_runs" ADD COLUMN "fetch_audit" JSONB;

CREATE TABLE "source_url_caches" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "canonical_url" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "etag" TEXT,
  "last_modified" TEXT,
  CONSTRAINT "source_url_caches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_url_caches_source_id_canonical_url_key"
  ON "source_url_caches"("source_id", "canonical_url");

ALTER TABLE "source_url_caches"
  ADD CONSTRAINT "source_url_caches_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
