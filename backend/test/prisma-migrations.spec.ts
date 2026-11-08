import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);

function allMigrationSql(): string {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) =>
      readFileSync(
        new URL(`${entry.name}/migration.sql`, migrationsDirectory),
        'utf8',
      ),
    )
    .join('\n');
}

describe('Prisma migration coverage', () => {
  it('creates every follow progress column required by the current schema', () => {
    const sql = allMigrationSql();

    expect(sql).toMatch(/"material_statuses"\s+JSONB/);
    expect(sql).toMatch(/"consultation_notes"\s+JSONB/);
    expect(sql).toMatch(/"version"\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/);
  });

  it('service desk closure migration is incremental, repeatable and never fabricates links', () => {
    const entries = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const closureMigration = entries.find((name) =>
      name.endsWith('_service_desk_closure'),
    );
    expect(closureMigration).toBeDefined();

    const sql = readFileSync(
      new URL(`${closureMigration}/migration.sql`, migrationsDirectory),
      'utf8',
    );
    // 增量、可重复执行：新增列/表/索引都带 IF NOT EXISTS
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "is_active"/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "link_path"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "service_tasks"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "ticket_supplements"/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "ticket_events"/);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "service_desk_reminders_task_id_stage_level_cycle_key_recipient_id_key"/,
    );
    // 不删除历史、不清空业务数据
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM/);
    // 历史缺发布关联只标记待核验，不猜测或批量回填关联
    expect(sql).toMatch(/SET "history_pending_verification" = true/);
    expect(sql).toMatch(/AND "resolved_announcement_id" IS NULL/);
    expect(sql).not.toMatch(/SET "resolved_announcement_id"\s*=/);
  });

  it('v7.2 withdraw migration adds the three audit columns to published_announcement_versions', () => {
    const entries = readdirSync(migrationsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const withdrawMigration = entries.find((name) =>
      name.endsWith('_v72_withdraw_relation'),
    );
    expect(withdrawMigration).toBeDefined();

    const sql = readFileSync(
      new URL(`${withdrawMigration}/migration.sql`, migrationsDirectory),
      'utf8',
    );
    expect(sql).toMatch(
      /ALTER TABLE "published_announcement_versions" ADD COLUMN "withdrawn_at" TIMESTAMP\(3\);/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "published_announcement_versions" ADD COLUMN "withdraw_reason" TEXT;/,
    );
    expect(sql).toMatch(
      /ALTER TABLE "published_announcement_versions" ADD COLUMN "withdrawn_by" TEXT;/,
    );
  });
});
