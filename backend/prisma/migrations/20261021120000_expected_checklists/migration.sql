-- M2 固定分母与遗漏检测：ExpectedChecklist 模型（PR 时间 2026-10-21）。
-- 该模型在 M2 时只做了 prisma generate，迁移 SQL 漏放进 prisma/migrations/，
-- 2026-10-22 生产部署后 getRun 查询报 P2021（表不存在）。本迁移补齐。
-- 与 schema.prisma 的 ExpectedChecklist 模型逐一对应（含 @@map 蛇形列名）。
CREATE TABLE "expected_checklists" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "snapshot_id" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'independent',
    "slots" JSONB NOT NULL,
    "frozen_at" TIMESTAMP(3) NOT NULL,
    "frozen_by" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expected_checklists_pkey" PRIMARY KEY ("id")
);

-- runId 一对一唯一（@unique），旧任务可空 → 旧行不迁移，新冻结任务写入
CREATE UNIQUE INDEX "expected_checklists_run_id_key" ON "expected_checklists"("run_id");

-- 外键：清单跟随 run 级联删除（@relation onDelete: Cascade）
ALTER TABLE "expected_checklists" ADD CONSTRAINT "expected_checklists_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "extraction_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- @@index([runId])
CREATE INDEX "expected_checklists_run_id_idx" ON "expected_checklists"("run_id");
