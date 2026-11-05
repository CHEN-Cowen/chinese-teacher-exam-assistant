-- W4：问答答案、反馈与 AI 用量预算（W3 遗漏的迁移，隔离环境补建）
CREATE TABLE "qa_answers" (
    "id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "announcement_id" TEXT,
    "unit_id" TEXT,
    "region_code" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "citations" JSONB NOT NULL,
    "needs_official_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "mode" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "index_versions" JSONB,
    "usage" JSONB,
    "latency_ms" INTEGER NOT NULL,
    "user_id" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_answers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qa_answers_announcement_id_created_at_idx" ON "qa_answers"("announcement_id", "created_at");
CREATE INDEX "qa_answers_user_id_created_at_idx" ON "qa_answers"("user_id", "created_at");

CREATE TABLE "qa_feedback" (
    "id" TEXT NOT NULL,
    "answer_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "qa_feedback_answer_id_idx" ON "qa_feedback"("answer_id");
CREATE INDEX "qa_feedback_status_created_at_idx" ON "qa_feedback"("status", "created_at");

ALTER TABLE "qa_feedback" ADD CONSTRAINT "qa_feedback_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "qa_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_usage_daily" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_daily_scope_subject_day_key" ON "ai_usage_daily"("scope", "subject", "day");
