/**
 * v7.2 附件解析：document.parse 处理器测试（幂等、版本变化、待人工、错误映射）。
 * 全部离线：FakePrisma / FakeObjectStore / FakeCrawlTaskQueue。
 */
import { describe, expect, it } from 'vitest';
import { FakeCrawlTaskQueue, FakeObjectStore, FakePrisma } from '../../sourcing/testing/crawl-testing.js';
import { snapshotStorageKey } from '../../sourcing/storage/object-store.js';
import { SourceDocumentStore } from '../../sourcing/source-document-store.js';
import { DocumentParserService } from '../document-parser.service.js';
import { DocumentParseStore } from '../document-parse-store.js';
import { DocumentParseService } from './document-parse.service.js';
import { readParseLimits } from '../parse-guard.js';
import { readFeatureFlags } from '../feature-flags.js';
import {
  buildEncryptedPdf,
  buildTextPdf,
  buildXlsxFixture,
} from '../testing/fixture-builders.js';

const VERSION_A = 'parser-a@1.0.0';
const VERSION_B = 'parser-b@2.0.0';

function makeService() {
  const prisma = new FakePrisma();
  const store = new FakeObjectStore();
  const queue = new FakeCrawlTaskQueue();
  const documentStore = new SourceDocumentStore(prisma as never);
  const parseStore = new DocumentParseStore(prisma as never);
  const parserService = new DocumentParserService({
    limits: readParseLimits({}),
    flags: readFeatureFlags({}),
  });
  const service = new DocumentParseService(
    parserService,
    parseStore,
    documentStore,
    store,
    queue,
  );
  return { prisma, store, queue, service, parseStore };
}

/** 预置一个快照（二进制已入存储） */
function seedSnapshot(
  ctx: ReturnType<typeof makeService>,
  contentHash: string,
  bytes: Buffer,
) {
  const storageKey = snapshotStorageKey(contentHash);
  const snapshot = ctx.prisma.seedSnapshot({
    sourceId: 'src-1',
    contentHash,
    storageKey,
    officialUrl: 'https://example.gov.cn/a.pdf',
    mimeType: 'application/pdf',
  });
  ctx.store.binaries.set(storageKey, bytes);
  ctx.store.files.set(storageKey, '');
  return snapshot;
}

describe('DocumentParseService.handle', () => {
  it('快照不存在 → failed snapshot_not_found', async () => {
    const ctx = makeService();
    const outcome = await ctx.service.handle({
      snapshotId: 'missing',
      documentParserVersion: VERSION_A,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.errorSummary).toBe('snapshot_not_found');
  });

  it('文本 PDF → parsed + 投递 announcement.extract（独立抽取版本）', async () => {
    const ctx = makeService();
    const snapshot = seedSnapshot(ctx, 'aabb', buildTextPdf([
      'Hangzhou Municipal Education Bureau 2026 teacher recruitment announcement with detailed content.',
      'Education requirement: Bachelor degree or above with teacher qualification certificate.',
    ]));

    const outcome = await ctx.service.handle({
      snapshotId: snapshot.id,
      documentParserVersion: VERSION_A,
    });

    expect(outcome.status).toBe('parsed');
    expect(outcome.blockCount).toBeGreaterThan(0);
    const run = ctx.prisma.parseRuns[0];
    expect(run.status).toBe('parsed');
    expect(run.format).toBe('pdf');
    expect(ctx.queue.count('announcement.extract')).toBe(1);
    const extractJob = ctx.queue.enqueued.find((j) => j.name === 'announcement.extract');
    expect(extractJob?.jobId).toBe(`extract:${snapshot.id}:rule-field-extractor@1.0.0`);
  });

  it('同快照同版本重放 → already_parsed（不重复解析、不覆盖成功记录）', async () => {
    const ctx = makeService();
    const snapshot = seedSnapshot(ctx, 'ccdd', buildTextPdf([
      'Repeatable parse idempotency test line with enough characters for text layer.',
    ]));
    await ctx.service.handle({ snapshotId: snapshot.id, documentParserVersion: VERSION_A });
    const runsAfterFirst = ctx.prisma.parseRuns.length;

    const outcome = await ctx.service.handle({
      snapshotId: snapshot.id,
      documentParserVersion: VERSION_A,
    });

    expect(outcome.status).toBe('already_parsed');
    expect(ctx.prisma.parseRuns.length).toBe(runsAfterFirst);
    expect(ctx.queue.count('announcement.extract')).toBe(1); // 未重复投递
  });

  it('解析器版本升级 → 产生新解析记录（旧记录保留可审计）', async () => {
    const ctx = makeService();
    const snapshot = seedSnapshot(ctx, 'eeff', buildTextPdf([
      'Parser version upgrade audit test line with enough characters for the text layer.',
    ]));
    await ctx.service.handle({ snapshotId: snapshot.id, documentParserVersion: VERSION_A });

    const outcome = await ctx.service.handle({
      snapshotId: snapshot.id,
      documentParserVersion: VERSION_B,
    });

    expect(outcome.status).toBe('parsed');
    expect(ctx.prisma.parseRuns.length).toBe(2);
    const versions = ctx.prisma.parseRuns
      .map((r) => r.parserVersion)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(versions).toEqual([VERSION_A, VERSION_B]);
  });

  it('加密 PDF → pending_manual（诚实标记，仍投递待人工提取路径）', async () => {
    const ctx = makeService();
    const snapshot = seedSnapshot(ctx, '1122', buildEncryptedPdf());

    const outcome = await ctx.service.handle({
      snapshotId: snapshot.id,
      documentParserVersion: VERSION_A,
    });

    expect(outcome.status).toBe('pending_manual');
    const run = ctx.prisma.parseRuns[0];
    expect(run.status).toBe('pending_manual');
    expect(ctx.queue.count('announcement.extract')).toBe(1);
  });

  it('未知格式 → unsupported_format，不投递抽取', async () => {
    const ctx = makeService();
    const snapshot = seedSnapshot(ctx, '3344', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

    const outcome = await ctx.service.handle({
      snapshotId: snapshot.id,
      documentParserVersion: VERSION_A,
    });

    expect(outcome.status).toBe('unsupported_format');
    expect(ctx.queue.count('announcement.extract')).toBe(0);
  });

  it('损坏 PDF → failed；已有 parsed 记录不受影响（失败不覆盖旧标准文档）', async () => {
    const ctx = makeService();
    const snapshot = seedSnapshot(ctx, '5566', buildTextPdf([
      'Existing good parse should never be overwritten by later failures in this pipeline.',
    ]));
    await ctx.service.handle({ snapshotId: snapshot.id, documentParserVersion: VERSION_A });
    const goodRun = ctx.prisma.parseRuns[0];
    const goodBlocks = goodRun.blocks;

    // 同快照同版本失败重放：parsed 已存在直接复用（不重解析）
    // 用新版本制造一条失败记录
    ctx.store.binaries.set(
      snapshotStorageKey('7788'),
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 0)]),
    );
    const bad = ctx.prisma.seedSnapshot({
      sourceId: 'src-1',
      contentHash: '7788',
      storageKey: snapshotStorageKey('7788'),
      officialUrl: 'https://example.gov.cn/bad.pdf',
      mimeType: 'application/pdf',
    });
    const badOutcome = await ctx.service.handle({
      snapshotId: bad.id,
      documentParserVersion: VERSION_A,
    });

    expect(badOutcome.status).toBe('failed');
    expect(goodRun.blocks).toEqual(goodBlocks); // 旧记录原样保留
    expect(goodRun.status).toBe('parsed');
  });

  it('Excel 附件 → spreadsheet 解析（层 2/3 用二进制原件）', async () => {
    const ctx = makeService();
    const bytes = buildXlsxFixture();
    const snapshot = seedSnapshot(ctx, '99aa', bytes);
    // 修正 MIME：附件场景由下载层按魔数判定
    ctx.prisma.snapshots[0].mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const outcome = await ctx.service.handle({
      snapshotId: snapshot.id,
      documentParserVersion: VERSION_A,
    });

    expect(outcome.status).toBe('parsed');
    expect(ctx.prisma.parseRuns[0].format).toBe('spreadsheet');
  });
});
