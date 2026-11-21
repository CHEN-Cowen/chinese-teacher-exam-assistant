-- W1 全学科：订阅支持多学科关注，保留 subject 兼容旧数据。
ALTER TABLE "opportunity_subscriptions"
  ADD COLUMN IF NOT EXISTS "subjects" JSONB;
