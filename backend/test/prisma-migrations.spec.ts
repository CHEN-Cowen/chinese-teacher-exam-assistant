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
