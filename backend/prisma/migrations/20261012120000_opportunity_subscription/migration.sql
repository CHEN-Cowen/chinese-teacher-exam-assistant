-- 新机会订阅与提醒（v7.1 M6）

-- 订阅表：每用户一条，默认条件来自画像（地区/语文学科/用工偏好/资格快照）
CREATE TABLE "opportunity_subscriptions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "regions" JSONB NOT NULL,
  "subject" TEXT NOT NULL DEFAULT 'chinese',
  "nature_preference" TEXT NOT NULL DEFAULT 'undecided',
  "qualification" JSONB,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "opportunity_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opportunity_subscriptions_user_id_key"
  ON "opportunity_subscriptions"("user_id");

-- 提醒幂等日志：同一用户和公告在同一发布版本下只提醒一次；
-- 首次同步基线回填（notified=false）不产生通知风暴
CREATE TABLE "opportunity_notice_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "announcement_id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "dedup_key" TEXT NOT NULL,
  "notified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "opportunity_notice_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "opportunity_notice_logs_user_id_dedup_key_key"
  ON "opportunity_notice_logs"("user_id", "dedup_key");
CREATE INDEX "opportunity_notice_logs_user_id_notified_idx"
  ON "opportunity_notice_logs"("user_id", "notified");
