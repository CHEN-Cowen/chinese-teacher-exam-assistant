/**
 * v7.2 工作包 4：发现处理器（source.discover）测试。
 *
 * 覆盖：黄金样本发现、栏目 304、DOM 失配记结构变化（绝不记为“无新公告”）、
 * 栏目版本未变时不重复投递、全部请求失败计入连续失败、未配置适配器。
 * 全部离线：注入 fetch/DNS/sleep，只读黄金样本。
 */
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter-registry.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import { HangzhouEducationAdapter } from '../adapters/hangzhou-education.adapter.js';
import { NingboEducationAdapter } from '../adapters/ningbo-education.adapter.js';
import { YinzhouGovernmentAdapter } from '../adapters/yinzhou-government.adapter.js';
import { SourceDiscoverService } from './source-discover.service.js';
import type { SourceDiscoverPayload } from './task-queue.js';
import {
  FakeCrawlTaskQueue,
  FakePrisma,
  OfflineFetcherFactory,
  readGolden,
  type OfflineRoute,
} from '../testing/crawl-testing.js';

const LIST_URL = 'https://edu.hangzhou.gov.cn/col/col123/index.html';
const DETAIL_URL =
  'https://edu.hangzhou.gov.cn/art/2026/10/9/art_1229391906_59012345.html';
const SOURCE_ID = 'src-hz';

async function setup(
  routes: OfflineRoute,
  sourceOverrides: Record<string, unknown> = {},
) {
  const prisma = new FakePrisma();
  const source = prisma.seedSource({
    id: SOURCE_ID,
    publisher: '杭州市教育局',
    officialUrl: LIST_URL,
    adapterKey: 'hangzhou-education',
    allowedHosts: ['edu.hangzhou.gov.cn'],
    ...sourceOverrides,
  });
  const queue = new FakeCrawlTaskQueue();
  const runStore = new CrawlRunStore(prisma as never);
  const documentStore = new SourceDocumentStore(prisma as never);
  const registry = new AdapterRegistry(
    new HangzhouEducationAdapter(),
    new NingboEducationAdapter(),
    new YinzhouGovernmentAdapter(),
  );
  const factory = new OfflineFetcherFactory(routes);
  const service = new SourceDiscoverService(
    runStore,
    documentStore,
    factory,
    registry,
    queue,
  );
  const run = await runStore.createRun({ sourceId: SOURCE_ID, trigger: 'schedule' });
  const payload: SourceDiscoverPayload = {
    sourceId: SOURCE_ID,
    runId: run.id,
    trigger: 'schedule',
    checkWindow: 'w1',
  };
  return { prisma, source, queue, service, payload };
}

/** 取出投递的 document.fetch 载荷 URL */
function fetchUrls(queue: FakeCrawlTaskQueue): string[] {
  return queue.enqueued
    .filter((job) => job.name === 'document.fetch')
    .map(
      (job) =>
        (queue.jobs.get(job.jobId)!.payload as { canonicalUrl: string }).canonicalUrl,
    );
}

describe('SourceDiscoverService.handle', () => {
  it('黄金样本：发现 1 条公告并投递 document.fetch，运行记为 succeeded', async () => {
    const { prisma, queue, service, payload } = await setup({
      [LIST_URL]: readGolden('hangzhou', 'list.html'),
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('succeeded');
    expect(outcome.discoveredCount).toBe(1);
    expect(fetchUrls(queue)).toEqual([DETAIL_URL]);

    const doc = prisma.documents.find((d) => d.canonicalUrl === DETAIL_URL);
    expect(doc).toBeDefined();
    expect(doc!.kind).toBe('announcement');

    const run = prisma.findRun(payload.runId)!;
    expect(run.status).toBe('succeeded');
    expect(run.discoveredCount).toBe(1);
    expect(prisma.sources[0].healthStatus).toBe('healthy');
    expect(prisma.sources[0].lastCheckedAt).not.toBeNull();
  });

  it('栏目 304：视为未变化，不解析、不投递，运行记为 no_new', async () => {
    const { queue, service, payload } = await setup({
      [LIST_URL]: { status: 304 },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('no_new');
    expect(outcome.discoveredCount).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it('DOM 失配：记为 structure_changed，绝不记为 no_new', async () => {
    const broken = readGolden('hangzhou', 'list.html').replace(
      /<ul[^>]*class="[^"]*\bnews-list\b[^"]*"[^>]*>[\s\S]*?<\/ul>/i,
      '',
    );
    const { prisma, service, payload } = await setup({ [LIST_URL]: broken });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('structure_changed');
    expect(outcome.status).not.toBe('no_new');
    expect(prisma.sources[0].healthStatus).toBe('structure_changed');
    expect(prisma.findRun(payload.runId)!.status).toBe('structure_changed');
  });

  it('栏目版本未变（ETag 相同）且已有快照：不重复投递 document.fetch', async () => {
    const listHtml = readGolden('hangzhou', 'list.html');
    const prisma = new FakePrisma();
    prisma.seedSource({
      id: SOURCE_ID,
      publisher: '杭州市教育局',
      officialUrl: LIST_URL,
      adapterKey: 'hangzhou-education',
      allowedHosts: ['edu.hangzhou.gov.cn'],
      etag: 'W/"v1"',
    });
    const queue = new FakeCrawlTaskQueue();
    const runStore = new CrawlRunStore(prisma as never);
    const documentStore = new SourceDocumentStore(prisma as never);
    // 该文档已有快照（此前已抓取过）
    prisma.seedDocument({
      sourceId: SOURCE_ID,
      canonicalUrl: DETAIL_URL,
      latestSnapshotId: 'snap-existing',
      contentHash: 'hash-existing',
    });
    const service = new SourceDiscoverService(
      runStore,
      documentStore,
      new OfflineFetcherFactory({
        [LIST_URL]: { status: 200, headers: { etag: 'W/"v1"' }, body: listHtml },
      }),
      new AdapterRegistry(
        new HangzhouEducationAdapter(),
        new NingboEducationAdapter(),
        new YinzhouGovernmentAdapter(),
      ),
      queue,
    );
    const run = await runStore.createRun({ sourceId: SOURCE_ID, trigger: 'schedule' });

    const outcome = await service.handle({
      sourceId: SOURCE_ID,
      runId: run.id,
      trigger: 'schedule',
      checkWindow: 'w2',
    });

    expect(outcome.discoveredCount).toBe(1);
    expect(queue.count('document.fetch')).toBe(0);
    expect(outcome.unchangedCount).toBe(1);
  });

  it('栏目页全部请求失败：运行记 failed，来源连续失败 +1', async () => {
    const { prisma, queue, service, payload } = await setup({
      [LIST_URL]: { status: 500, body: 'server error' },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('failed');
    expect(queue.enqueued).toHaveLength(0);
    expect(prisma.sources[0].consecutiveFailures).toBe(1);
    expect(prisma.findRun(payload.runId)!.status).toBe('failed');
  });

  it('未配置适配器：运行记 failed，来源标为 degraded', async () => {
    const { prisma, service, payload } = await setup(
      { [LIST_URL]: readGolden('hangzhou', 'list.html') },
      { adapterKey: null },
    );

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('failed');
    expect(outcome.errorSummary).toBe('adapter_not_configured');
    expect(prisma.sources[0].healthStatus).toBe('degraded');
  });

  it('HTTP 403（封禁）：转人工，来源标 blocked，不计入普通连续失败', async () => {
    const { prisma, queue, service, payload } = await setup({
      [LIST_URL]: { status: 403, body: 'forbidden' },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('blocked');
    expect(prisma.sources[0].healthStatus).toBe('blocked');
    expect(prisma.sources[0].consecutiveFailures).toBe(0);
    expect(prisma.findRun(payload.runId)!.status).toBe('blocked');
    expect(queue.enqueued).toHaveLength(0);
  });

  it('验证码挑战页（200 但含人机验证）：转人工，不解析也不误报无新公告', async () => {
    const challenge =
      '<html><head><title>安全验证</title></head><body>请完成验证码后继续访问</body></html>';
    const { prisma, service, payload } = await setup({ [LIST_URL]: challenge });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('blocked');
    expect(outcome.status).not.toBe('no_new');
    expect(prisma.sources[0].healthStatus).toBe('blocked');
  });

  it('栏目 304（未变化）即使有历史发现也不算异常零结果', async () => {
    const { prisma, service, payload } = await setup({
      [LIST_URL]: { status: 304 },
    });
    prisma.seedDocument({
      sourceId: SOURCE_ID,
      canonicalUrl: DETAIL_URL,
      latestSnapshotId: 'snap-old',
      contentHash: 'hash-old',
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('no_new');
    expect(prisma.sources[0].consecutiveFailures).toBe(0);
    expect(prisma.findRun(payload.runId)!.status).toBe('no_new');
  });
});

describe('SourceDiscoverService 静默 0 条告警（成功 ≠ 健康）', () => {
  /**
   * 返回空数组的桩适配器：真实适配器对空列表抛 DOM_MISMATCH（走 structure_changed），
   * 只有“结构正常但确实没有条目”的适配器才会走到静默 0 条判定。
   */
  const emptyAdapter = {
    key: 'hangzhou-education',
    discover: () => [] as never[],
    locateArticle: (): never => {
      throw new Error('本测试不抓取正文');
    },
  };

  async function setupEmptyList(options: { withHistory: boolean }) {
    const prisma = new FakePrisma();
    prisma.seedSource({
      id: SOURCE_ID,
      publisher: '杭州市教育局',
      officialUrl: LIST_URL,
      adapterKey: 'hangzhou-education',
      allowedHosts: ['edu.hangzhou.gov.cn'],
    });
    if (options.withHistory) {
      prisma.seedDocument({
        sourceId: SOURCE_ID,
        canonicalUrl: DETAIL_URL,
        latestSnapshotId: 'snap-old',
        contentHash: 'hash-old',
      });
    }
    const queue = new FakeCrawlTaskQueue();
    const runStore = new CrawlRunStore(prisma as never);
    const documentStore = new SourceDocumentStore(prisma as never);
    const registry = { get: () => emptyAdapter } as unknown as AdapterRegistry;
    const service = new SourceDiscoverService(
      runStore,
      documentStore,
      new OfflineFetcherFactory({
        [LIST_URL]: '<html><body><ul class="news-list"></ul></body></html>',
      }),
      registry,
      queue,
    );
    const run = await runStore.createRun({ sourceId: SOURCE_ID, trigger: 'schedule' });
    const payload: SourceDiscoverPayload = {
      sourceId: SOURCE_ID,
      runId: run.id,
      trigger: 'schedule',
      checkWindow: 'w-zero',
    };
    return { prisma, queue, service, payload };
  }

  it('历史来源成功抓取却 0 条 → zero_suspect：recordFailure（suspected_zero_results），不得 recordSuccess', async () => {
    const { prisma, queue, service, payload } = await setupEmptyList({ withHistory: true });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('zero_suspect');
    const run = prisma.findRun(payload.runId)!;
    expect(run.status).toBe('zero_suspect');
    expect(run.discoveredCount).toBe(0);
    expect(run.errorSummary).toBe('suspected_zero_results');
    // recordFailure 被调用（计入连续失败，达到阈值会自动 degraded）
    expect(prisma.sources[0].consecutiveFailures).toBe(1);
    expect(prisma.sources[0].lastFailReason).toBe('suspected_zero_results');
    // recordSuccess 未被调用：lastSuccessAt 仍为空
    expect(prisma.sources[0].lastSuccessAt ?? null).toBeNull();
    expect(queue.enqueued).toHaveLength(0);
  });

  it('异常零结果累计到阈值同样自动 degraded（复用 recordFailure 现有逻辑）', async () => {
    const { prisma, service, payload } = await setupEmptyList({ withHistory: true });
    await prisma.source.update({
      where: { id: SOURCE_ID },
      data: { consecutiveFailures: 2 },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('zero_suspect');
    expect(prisma.sources[0].consecutiveFailures).toBe(3);
    expect(prisma.sources[0].healthStatus).toBe('degraded');
  });

  it('新来源（无历史发现）0 条 → 正常 no_new + recordSuccess', async () => {
    const { prisma, service, payload } = await setupEmptyList({ withHistory: false });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('no_new');
    expect(prisma.findRun(payload.runId)!.status).toBe('no_new');
    expect(prisma.sources[0].consecutiveFailures).toBe(0);
    expect(prisma.sources[0].healthStatus).toBe('healthy');
    expect(prisma.sources[0].lastSuccessAt).not.toBeNull();
  });
});
