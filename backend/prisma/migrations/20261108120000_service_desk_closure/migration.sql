-- 异常转人工与人工处理闭环（2026-11-08）
-- 增量、可重复执行；不删除历史、不伪造回填。

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "notification_records" ADD COLUMN IF NOT EXISTS "link_path" TEXT;

ALTER TABLE "opportunity_corrections" ADD COLUMN IF NOT EXISTS "related_ticket_no" TEXT;

ALTER TABLE "announcement_submissions" ADD COLUMN IF NOT EXISTS "resolved_announcement_id" TEXT;
ALTER TABLE "announcement_submissions" ADD COLUMN IF NOT EXISTS "resolved_version_id" TEXT;
ALTER TABLE "announcement_submissions" ADD COLUMN IF NOT EXISTS "resolution_basis" TEXT;
ALTER TABLE "announcement_submissions" ADD COLUMN IF NOT EXISTS "history_pending_verification" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "announcement_submissions" ADD COLUMN IF NOT EXISTS "related_ticket_no" TEXT;

-- 历史已收录但缺少发布关联：标记待核验（不猜测、不批量编造关联）
UPDATE "announcement_submissions"
SET "history_pending_verification" = true
WHERE "status" = 'resolved'
  AND "resolved_announcement_id" IS NULL
  AND "history_pending_verification" = false;

CREATE TABLE IF NOT EXISTS "service_tasks" (
  "id" TEXT NOT NULL,
  "ticket_no" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "ref_id" TEXT NOT NULL,
  "ref_key" TEXT,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "default_owner_id" TEXT,
  "assignee_id" TEXT,
  "claimed_at" TIMESTAMP(3),
  "last_handler_id" TEXT,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "priority_reason" TEXT,
  "priority_source" TEXT NOT NULL DEFAULT 'system',
  "waiting_on" TEXT,
  "status_version" INTEGER NOT NULL DEFAULT 1,
  "first_response_at" TIMESTAMP(3),
  "last_effective_update_at" TIMESTAMP(3),
  "response_due_at" TIMESTAMP(3),
  "update_due_at" TIMESTAMP(3),
  "escalation_due_at" TIMESTAMP(3),
  "cycle_started_at" TIMESTAMP(3),
  "paused_remaining_ms" INTEGER,
  "paused_at" TIMESTAMP(3),
  "total_paused_ms" INTEGER NOT NULL DEFAULT 0,
  "waiting_reason" TEXT,
  "last_checked_at" TIMESTAMP(3),
  "next_follow_up_at" TIMESTAMP(3),
  "last_reminder_at" TIMESTAMP(3),
  "escalation_count" INTEGER NOT NULL DEFAULT 0,
  "routed_to_admin" BOOLEAN NOT NULL DEFAULT false,
  "route_issue" TEXT,
  "outcome" TEXT,
  "resolution_note" TEXT,
  "resolved_by" TEXT,
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "service_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_tasks_ticket_no_key" ON "service_tasks"("ticket_no");
CREATE UNIQUE INDEX IF NOT EXISTS "service_tasks_ref_key_key" ON "service_tasks"("ref_key");
CREATE UNIQUE INDEX IF NOT EXISTS "service_tasks_type_ref_id_key" ON "service_tasks"("type", "ref_id");
CREATE INDEX IF NOT EXISTS "service_tasks_status_priority_update_due_at_idx" ON "service_tasks"("status", "priority", "update_due_at");
CREATE INDEX IF NOT EXISTS "service_tasks_assignee_id_status_idx" ON "service_tasks"("assignee_id", "status");
CREATE INDEX IF NOT EXISTS "service_tasks_default_owner_id_status_idx" ON "service_tasks"("default_owner_id", "status");
CREATE INDEX IF NOT EXISTS "service_tasks_type_status_idx" ON "service_tasks"("type", "status");

CREATE TABLE IF NOT EXISTS "ticket_supplements" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "ticket_type" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "author_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "links" JSONB,
  "dedupe_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_supplements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_supplements_task_id_dedupe_key_key" ON "ticket_supplements"("task_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "ticket_supplements_ticket_type_ticket_id_created_at_idx" ON "ticket_supplements"("ticket_type", "ticket_id", "created_at");

CREATE TABLE IF NOT EXISTS "ticket_events" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "ticket_no" TEXT NOT NULL,
  "ticket_type" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_id" TEXT,
  "actor_role" TEXT,
  "visibility" TEXT NOT NULL DEFAULT 'public',
  "message" TEXT,
  "before_value" JSONB,
  "after_value" JSONB,
  "dedupe_key" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_events_task_id_dedupe_key_key" ON "ticket_events"("task_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "ticket_events_ticket_type_ticket_id_created_at_idx" ON "ticket_events"("ticket_type", "ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "ticket_events_task_id_visibility_created_at_idx" ON "ticket_events"("task_id", "visibility", "created_at");

CREATE TABLE IF NOT EXISTS "service_desk_configs" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "duty_owner_id" TEXT,
  "backup_owner_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_desk_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "service_desk_policies" (
  "id" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "first_response_minutes" INTEGER NOT NULL,
  "update_minutes" INTEGER NOT NULL,
  "escalation_grace_minutes" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "created_by" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_desk_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_desk_policies_priority_version_key" ON "service_desk_policies"("priority", "version");
CREATE INDEX IF NOT EXISTS "service_desk_policies_priority_active_version_idx" ON "service_desk_policies"("priority", "active", "version");

CREATE TABLE IF NOT EXISTS "service_desk_config_audits" (
  "id" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "reason" TEXT,
  "before_value" JSONB,
  "after_value" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_desk_config_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "service_desk_config_audits_entity_created_at_idx" ON "service_desk_config_audits"("entity", "created_at");

CREATE TABLE IF NOT EXISTS "service_desk_reminders" (
  "id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "cycle_key" TEXT NOT NULL,
  "recipient_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_desk_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "service_desk_reminders_task_id_stage_level_cycle_key_recipient_id_key"
  ON "service_desk_reminders"("task_id", "stage", "level", "cycle_key", "recipient_id");
CREATE INDEX IF NOT EXISTS "service_desk_reminders_task_id_created_at_idx" ON "service_desk_reminders"("task_id", "created_at");
