-- 公告补录提交与纠错版本落点（D08 / PRD 11.9 U08）
--
-- 1) announcement_submissions：用户报告未收录官方公告，只进运营待办队列，
--    不直接进入采集与发布；url_hash 为规范化链接的 SHA-256（去重键）。
-- 2) opportunity_corrections 增加 resolved_version_id：采纳修正时登记
--    已发布版本 id（可空），用户侧可回详情核对修正落点。

CREATE TABLE "announcement_submissions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "official_url" TEXT NOT NULL,
  "url_hash" TEXT NOT NULL,
  "publisher_name" TEXT NOT NULL,
  "region_code" TEXT NOT NULL,
  "note" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "review_note" TEXT,
  "reviewer_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "announcement_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcement_submissions_user_id_created_at_idx"
  ON "announcement_submissions"("user_id", "created_at");

CREATE INDEX "announcement_submissions_url_hash_idx"
  ON "announcement_submissions"("url_hash");

CREATE INDEX "announcement_submissions_status_created_at_idx"
  ON "announcement_submissions"("status", "created_at");

ALTER TABLE "opportunity_corrections"
  ADD COLUMN "resolved_version_id" TEXT;

CREATE INDEX "opportunity_corrections_user_id_created_at_idx"
  ON "opportunity_corrections"("user_id", "created_at");
