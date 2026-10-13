/**
 * v7.2 证据链：announcement.extract 处理器测试。
 * 覆盖：正常候选+锚点重建、幂等、待人工解析诚实失败、无解析记录失败。
 */
import { describe, expect, it } from 'vitest';
import { FakePrisma } from '../../sourcing/testing/crawl-testing.js';
import { DocumentParseStore } from '../../document-processing/document-parse-store.js';
import { SpreadsheetDocumentParser } from '../../document-processing/parsers/spreadsheet-document.parser.js';
import { readParseLimits } from '../../document-processing/parse-guard.js';
import { buildXlsxFixture } from '../../document-processing/testing/fixture-builders.js';
import { AnnouncementExtractService } from './announcement-extract.service.js';

const PARSER_VERSION = 'rule-field-extractor@1.0.0';

function makeService() {
  const prisma = new FakePrisma();
  const parseStore = new DocumentParseStore(prisma as never);
  const service = new AnnouncementExtractService(prisma as never, parseStore);
  return { prisma, parseStore, service };
}

/** 预置一条 parsed 的解析记录（用真实表格解析器产出 blocks/表头） */
async function seedParsedRun(ctx: ReturnType<typeof makeService>, snapshotId: string) {
  const parsed = await new SpreadsheetDocumentParser(readParseLimits({})).parse({
    snapshotId,
    sourceUrl: 'https://example.gov.cn/p.xlsx',
    storageKey: 'snapshots/ab/abc',
    contentHash: 'abc123',
    declaredMime: '',
    declaredExtension: 'xlsx',
    bytes: buildXlsxFixture(),
  });
  const { run } = await ctx.parseStore.ensureRun({
    snapshotId,
    format: 'unknown',
    parserVersion: 'spreadsheet-parser@1.0.0',
    contentHash: 'abc123',
    sourceUrl: 'https://example.gov.cn/p.xlsx',
  });
  await ctx.parseStore.completeRun(run.id, {
    status: 'parsed',
    format: parsed.format,
    blocks: parsed.blocks,
    tableHeaders: parsed.tableHeaders ?? null,
    warnings: parsed.warnings,
  });
  return run;
}

describe('AnnouncementExtractService.handle', () => {
  it('无解析记录 → failed NO_PARSE_RUN（不编造字段）', async () => {
    const ctx = makeService();
    const outcome = await ctx.service.handle({
      snapshotId: 'snap-none',
      parserVersion: PARSER_VERSION,
    });
    expect(outcome.status).toBe('failed');
    const failed = ctx.prisma.extractionRuns[0];
    expect(failed.errorCode).toBe('NO_PARSE_RUN');
    expect(failed.status).toBe('failed');
  });

  it('解析为待人工 → 诚实失败 PENDING_MANUAL_PARSE（不伪装成功）', async () => {
    const ctx = makeService();
    const { run } = await ctx.parseStore.ensureRun({
      snapshotId: 'snap-manual',
      format: 'pdf',
      parserVersion: 'pdf-parser@1.0.0',
      contentHash: 'zz',
      sourceUrl: 'https://example.gov.cn/scan.pdf',
    });
    await ctx.parseStore.completeRun(run.id, {
      status: 'pending_manual',
      warnings: ['扫描件需要 OCR 或人工处理'],
    });

    const outcome = await ctx.service.handle({
      snapshotId: 'snap-manual',
      parserVersion: PARSER_VERSION,
    });

    expect(outcome.status).toBe('failed');
    const failed = ctx.prisma.extractionRuns[0];
    expect(failed.errorCode).toBe('PENDING_MANUAL_PARSE');
    expect(failed.errorMessage).toContain('待人工');
    expect(failed.status).toBe('failed');
  });

  it('正常解析 → pending_review 候选 + 证据锚点（locatorData 可回原文）', async () => {
    const ctx = makeService();
    await seedParsedRun(ctx, 'snap-x');

    const outcome = await ctx.service.handle({
      snapshotId: 'snap-x',
      parserVersion: PARSER_VERSION,
    });

    expect(outcome.status).toBe('pending_review');
    expect(outcome.fieldCount!).toBeGreaterThan(0);
    const run = ctx.prisma.extractionRuns[0];
    expect(run.status).toBe('pending_review');
    expect(run.idempotencyKey).toBe(`snap-x:${PARSER_VERSION}`);
    // 锚点与字段一一对应，且带富定位数据
    const anchors = ctx.prisma.evidenceAnchors.filter((a) => a.runId === run.id);
    expect(anchors.length).toBe(outcome.fieldCount);
    for (const anchor of anchors) {
      expect(anchor.locatorData).toBeTruthy();
      const data = anchor.locatorData as Record<string, unknown>;
      expect(data.snapshotId).toBe('snap-x');
      expect(data.contentHash).toBe('abc123');
    }
  });

  it('重跑同版本 → 幂等替换锚点，已有候选不降级', async () => {
    const ctx = makeService();
    await seedParsedRun(ctx, 'snap-r');
    const first = await ctx.service.handle({
      snapshotId: 'snap-r',
      parserVersion: PARSER_VERSION,
    });
    const firstRun = ctx.prisma.extractionRuns[0];
    const anchorsFirst = ctx.prisma.evidenceAnchors.filter((a) => a.runId === firstRun.id).length;

    const second = await ctx.service.handle({
      snapshotId: 'snap-r',
      parserVersion: PARSER_VERSION,
    });

    expect(second.status).toBe('skipped_already_done');
    expect(ctx.prisma.extractionRuns.length).toBe(1);
    expect(
      ctx.prisma.evidenceAnchors.filter((a) => a.runId === firstRun.id).length,
    ).toBe(anchorsFirst);
    expect(first.runId).toBe(firstRun.id);
  });

  it('失败记录可重试：同版本重跑会更新 failed 记录', async () => {
    const ctx = makeService();
    // 先失败（无解析记录）
    await ctx.service.handle({ snapshotId: 'snap-t', parserVersion: PARSER_VERSION });
    expect(ctx.prisma.extractionRuns[0].status).toBe('failed');

    // 人工补解析成功后重跑
    await seedParsedRun(ctx, 'snap-t');
    const retry = await ctx.service.handle({
      snapshotId: 'snap-t',
      parserVersion: PARSER_VERSION,
    });
    expect(retry.status).toBe('pending_review');
    expect(ctx.prisma.extractionRuns.length).toBe(1);
    expect(ctx.prisma.extractionRuns[0].status).toBe('pending_review');
  });
});

describe('证据完整性（发布前）', () => {
  it('每个候选字段的锚点都带 locatorData（快照 + 哈希 + 定位）', async () => {
    const ctx = makeService();
    await seedParsedRun(ctx, 'snap-v');
    await ctx.service.handle({ snapshotId: 'snap-v', parserVersion: PARSER_VERSION });
    const run = ctx.prisma.extractionRuns[0];
    const candidate = run.candidate as {
      fields: Array<{ field: string; anchor?: { locator: { kind: string } } }>;
    };
    expect(candidate.fields.length).toBeGreaterThan(0);
    for (const field of candidate.fields) {
      expect(field.anchor).toBeTruthy();
      expect(field.anchor!.locator.kind).toBeTruthy();
    }
  });
});
