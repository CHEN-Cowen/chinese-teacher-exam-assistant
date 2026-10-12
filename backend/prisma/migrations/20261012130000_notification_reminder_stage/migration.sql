-- M7：通知提醒阶段幂等键
-- 为 notification_records 新增 reminder_stage 列，用于时间倒计时提醒的幂等去重。
-- 同一 user_id + event_key + reminder_stage 组合唯一，保证每个提醒阶段只产生一次通知。
-- 非时间倒计时通知（如版本变更、新事件创建）reminder_stage 为 NULL，不受唯一约束限制（NULL ≠ NULL）。

ALTER TABLE "notification_records" ADD COLUMN "reminder_stage" TEXT;

-- 幂等唯一约束：同一用户+事件键+提醒阶段只产生一次通知
-- PostgreSQL 中 NULL 值不被视为相等，因此 event_key 或 reminder_stage 为 NULL 的行不受约束
CREATE UNIQUE INDEX "notification_records_userId_eventKey_reminderStage_key"
  ON "notification_records" ("user_id", "event_key", "reminder_stage");
