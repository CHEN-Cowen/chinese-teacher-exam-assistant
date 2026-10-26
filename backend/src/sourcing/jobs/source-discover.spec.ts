/**
 * v7.2 工作包 4：发现处理器（source.discover）测试。
 *
 * 覆盖：黄金样本发现、栏目 304、DOM 失配记结构变化（绝不记为“无新公告”）、
 * 栏目版本未变时不重复投递、全部请求失败计入连续失败、未配置适配器。
 * 全部离线：注入 fetch/DNS/sleep，只读黄金样本。
 */
import { describe, expect, it, vi } from 'vitest';
import { AdapterRegistry } from '../adapter-registry.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import { HangzhouEducationAdapter } from '../adapters/hangzhou-education.adapter.js';
import { NingboEducationAdapter } from '../adapters/ningbo-education.adapter.js';
import { YinzhouGovernmentAdapter } from '../adapters/yinzhou-government.adapter.js';
import { NanjingEducationAdapter } from '../adapters/nanjing-education.adapter.js';
import { ShaoxingEducationAdapter } from '../adapters/shaoxing-education.adapter.js';
import { JiaxingEducationAdapter } from '../adapters/jiaxing-education.adapter.js';
import { SuzhouEducationAdapter } from '../adapters/suzhou-education.adapter.js';
import { ChangzhouEducationAdapter } from '../adapters/changzhou-education.adapter.js';
import { LishuiEducationAdapter } from '../adapters/lishui-education.adapter.js';
import { SourceDiscoverService } from './source-discover.service.js';
import { publicColumnRequest, publicColumnPages } from '../public-column.js';
import type { SourceDiscoverPayload } from './task-queue.js';
import {
  FakeCrawlTaskQueue,
  FakePrisma,
  FakeObjectStore,
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
    new NanjingEducationAdapter(),
    new ShaoxingEducationAdapter(),
    new JiaxingEducationAdapter(),
    new SuzhouEducationAdapter(),
    new ChangzhouEducationAdapter(),
    new LishuiEducationAdapter(),
  );
  const factory = new OfflineFetcherFactory(routes);
  const service = new SourceDiscoverService(
    runStore,
    documentStore,
    factory,
    registry,
    queue,
    new FakeObjectStore(),
  );
  const run = await runStore.createRun({
    sourceId: SOURCE_ID,
    trigger: 'schedule',
  });
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
        (queue.jobs.get(job.jobId)!.payload as { canonicalUrl: string })
          .canonicalUrl,
    );
}

describe('SourceDiscoverService.handle', () => {
  it('公开动态列表走安全抓取和独立快照，栏目及接口304仍恢复发现', async () => {
    const list = 'https://jyj.ningbo.gov.cn/col/index.html';
    const shell = `<script src="/cms_files/default/script/AuthorizedRead/unitbuild.js" url="/api-gateway/jpaas-publish-server/front/page/build/unit" queryData="{'parseType':'bulidstatic','webId':'3505','tplSetId':'t','pageType':'column','tagId':'列表','editType':'null','pageId':'1'}"></script>`;
    const api = publicColumnRequest(list, shell)!;
    const response = JSON.stringify({
      success: true,
      data: {
        html: '<div class="page-content"><table><tr><td class="car_tl"><a href="/a.html" title="教师招聘">教师...</a></td><td class="car_time">2026-07-09</td></tr></table></div>',
      },
    });
    const routes: OfflineRoute = {
      [list]: { status: 200, body: shell, headers: { etag: 'shell' } },
      [api]: { status: 200, body: response, headers: { etag: 'api' } },
    };
    const context = await setup(routes, {
      officialUrl: list,
      listUrls: [list],
      adapterKey: 'ningbo-education',
      allowedHosts: ['jyj.ningbo.gov.cn'],
    });
    const outcome = await context.service.handle(context.payload);
    expect(outcome.errorSummary).toBeUndefined();
    expect(outcome).toMatchObject({ status: 'succeeded', discoveredCount: 1 });
    expect(context.prisma.snapshots).toHaveLength(2);
    expect(fetchUrls(context.queue)).toContain(
      'https://jyj.ningbo.gov.cn/a.html',
    );
    routes[list] = { status: 304 };
    routes[api] = { status: 304 };
    expect(
      (await context.service.handle(context.payload)).discoveredCount,
    ).toBe(1);
    expect(context.source.listUrls).toEqual([list]);
  });
  it('外壳200但动态接口503：冷启动也记录失败，重试时保持运行中', async () => {
    const list = 'https://jyj.ningbo.gov.cn/col/index.html';
    const shell = `<script src="/cms_files/default/script/AuthorizedRead/unitbuild.js" url="/api-gateway/jpaas-publish-server/front/page/build/unit" queryData="{'parseType':'bulidstatic','webId':'3505','tplSetId':'t','pageType':'column','tagId':'列表','editType':'null','pageId':'1'}"></script>`;
    const api = publicColumnRequest(list, shell)!;
    const { service, payload, prisma, queue } = await setup(
      {
        [list]: { status: 200, body: shell },
        [api]: { status: 503 },
      },
      {
        officialUrl: list,
        listUrls: [list],
        adapterKey: 'ningbo-education',
        allowedHosts: ['jyj.ningbo.gov.cn'],
      },
    );
    const outcome = await service.handle(payload, 1);
    expect(outcome).toMatchObject({
      status: 'failed',
      discoveredCount: 0,
      failedCount: 1,
    });
    expect(outcome.errorSummary).toContain(api);
    expect(prisma.findRun(payload.runId)!.status).toBe('running');
    expect(queue.enqueued).toHaveLength(0);
    expect((await service.handle(payload)).status).toBe('failed');
    expect(prisma.findRun(payload.runId)!.finishedAt).not.toBeNull();
    expect(prisma.sources[0].lastSuccessAt).toBeFalsy();
  });

  it('动态栏目遍历后续页，次页读取失败保留部分发现且不报完整成功', async () => {
    const list = 'https://jyj.ningbo.gov.cn/col/index.html';
    const shell = `<script src="/cms_files/default/script/AuthorizedRead/unitbuild.js" url="/api-gateway/jpaas-publish-server/front/page/build/unit" queryData="{'parseType':'bulidstatic','webId':'3505','tplSetId':'t','pageType':'column','tagId':'列表','editType':'null','pageId':'1'}"></script>`;
    const api = publicColumnRequest(list, shell)!;
    const response = (page: number) =>
      JSON.stringify({
        success: true,
        data: {
          html: `<div class="page-content"><table><tr><td class="car_tl"><a href="/a${page}.html" title="教师招聘${page}">教师招聘</a></td><td class="car_time">2026-07-09</td></tr></table></div><table class="pagination" querydata="{}" rows="1" count="2" pageNo="${page}"></table>`,
        },
      });
    const page2 = publicColumnPages(api, response(1))[0];
    const routes: OfflineRoute = {
      [list]: { status: 200, body: shell },
      [api]: { status: 200, body: response(1) },
      [page2]: { status: 200, body: response(2) },
    };
    const { service, payload, queue, prisma } = await setup(routes, {
      officialUrl: list,
      listUrls: [list],
      adapterKey: 'ningbo-education',
      allowedHosts: ['jyj.ningbo.gov.cn'],
    });
    expect(await service.handle(payload)).toMatchObject({
      status: 'succeeded',
      discoveredCount: 2,
    });
    expect(fetchUrls(queue)).toEqual([
      'https://jyj.ningbo.gov.cn/a1.html',
      'https://jyj.ningbo.gov.cn/a2.html',
    ]);
    expect(prisma.snapshots).toHaveLength(3);
    routes[page2] = { status: 503 };
    expect(await service.handle(payload)).toMatchObject({
      status: 'partial',
      discoveredCount: 1,
      failedCount: 1,
    });
  });

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
    expect(run.status).toBe('running');
    expect(run.finishedAt).toBeNull();
    expect(run.discoveredCount).toBe(1);
    expect(prisma.sources[0].healthStatus).toBe('healthy');
    expect(prisma.sources[0].lastCheckedAt).not.toBeNull();
  });

  it('发现投递耗尽重试：运行结算为失败并保留错误', async () => {
    const { prisma, queue, service, payload } = await setup({
      [LIST_URL]: readGolden('hangzhou', 'list.html'),
    });
    vi.spyOn(queue, 'enqueue').mockRejectedValue(
      new Error('queue unavailable'),
    );
    await expect(service.handle(payload, 1)).rejects.toThrow(
      'queue_enqueue_failed',
    );
    expect(prisma.findRun(payload.runId)!.status).toBe('running');
    await expect(service.handle(payload)).rejects.toThrow(
      'queue_enqueue_failed',
    );
    expect(prisma.findRun(payload.runId)!.status).toBe('partial');
    expect(prisma.findRun(payload.runId)!.finishedAt).not.toBeNull();
    expect(prisma.findRun(payload.runId)!.failedCount).toBe(1);
  });

  it('栏目瞬时 HTTP 故障仍有重试：保留进行中状态', async () => {
    const { prisma, service, payload } = await setup({
      [LIST_URL]: { status: 503 },
    });
    await service.handle(payload, 1);
    expect(prisma.findRun(payload.runId)!.status).toBe('running');
    expect(prisma.findRun(payload.runId)!.finishedAt).toBeNull();
  });

  it('栏目 304：无条件缓存时拒绝，把缓存缺失作为失败记录', async () => {
    const { prisma, queue, service, payload } = await setup({
      [LIST_URL]: { status: 304 },
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('failed');
    expect(outcome.discoveredCount).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
    expect(prisma.findRun(payload.runId)!.errorSummary).toContain(LIST_URL);
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

  it('栏目 304 从缓存恢复链接，并独立复查正文与已知附件', async () => {
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
    const objectStore = new FakeObjectStore();
    // 该文档已有快照（此前已抓取过）
    const oldList = prisma.seedSnapshot({
      sourceId: SOURCE_ID,
      contentHash: 'list-hash',
      officialUrl: LIST_URL,
    });
    oldList.storageKey = await objectStore.put({
      content: listHtml,
      contentHash: 'list-hash',
    });
    await prisma.sourceUrlCache.upsert({
      where: {
        sourceId_canonicalUrl: { sourceId: SOURCE_ID, canonicalUrl: LIST_URL },
      },
      create: {
        sourceId: SOURCE_ID,
        canonicalUrl: LIST_URL,
        snapshotId: oldList.id,
        etag: 'W/"v1"',
        lastModified: null,
      },
      update: {},
    });
    prisma.seedDocument({
      sourceId: SOURCE_ID,
      canonicalUrl: DETAIL_URL,
      latestSnapshotId: 'snap-existing',
      contentHash: 'hash-existing',
    });
    const attachmentUrl = 'https://edu.hangzhou.gov.cn/jobs.xlsx';
    prisma.seedDocument({
      sourceId: SOURCE_ID,
      canonicalUrl: attachmentUrl,
      kind: 'attachment',
    });
    const factory = new OfflineFetcherFactory({ [LIST_URL]: { status: 304 } });
    const service = new SourceDiscoverService(
      runStore,
      documentStore,
      factory,
      new AdapterRegistry(
        new HangzhouEducationAdapter(),
        new NingboEducationAdapter(),
        new YinzhouGovernmentAdapter(),
        new NanjingEducationAdapter(),
        new ShaoxingEducationAdapter(),
        new JiaxingEducationAdapter(),
        new SuzhouEducationAdapter(),
        new ChangzhouEducationAdapter(),
        new LishuiEducationAdapter(),
      ),
      queue,
      objectStore,
    );
    const run = await runStore.createRun({
      sourceId: SOURCE_ID,
      trigger: 'schedule',
    });

    const outcome = await service.handle({
      sourceId: SOURCE_ID,
      runId: run.id,
      trigger: 'schedule',
      checkWindow: 'w2',
    });

    expect(outcome.discoveredCount).toBe(1);
    expect(queue.count('document.fetch')).toBe(2);
    expect(fetchUrls(queue)).toContain(attachmentUrl);
    expect(factory.requestHeaders[0].get('if-none-match')).toBe('W/"v1"');
    expect(outcome.downloadedCount).toBe(0);
    expect(prisma.findRun(run.id)!.downloadedCount).toBe(0);
  });

  it('两栏目同哈希缓存：304 按各栏目 URL 解析相对链接', async () => {
    const firstUrl = 'https://edu.hangzhou.gov.cn/a/index.html';
    const secondUrl = 'https://edu.hangzhou.gov.cn/b/index.html';
    const prisma = new FakePrisma();
    prisma.seedSource({
      id: SOURCE_ID,
      officialUrl: firstUrl,
      listUrls: [firstUrl, secondUrl],
      adapterKey: 'hangzhou-education',
      allowedHosts: ['edu.hangzhou.gov.cn'],
    });
    const store = new CrawlRunStore(prisma as never);
    const documents = new SourceDocumentStore(prisma as never);
    const objects = new FakeObjectStore();
    const snapshot = prisma.seedSnapshot({
      sourceId: SOURCE_ID,
      contentHash: 'shared-list',
      officialUrl: firstUrl,
    });
    snapshot.storageKey = await objects.put({
      content: readGolden('hangzhou', 'list.html').replace(
        '/art/2026/10/9/art_1229391906_59012345.html',
        './detail.html',
      ),
      contentHash: 'shared-list',
    });
    for (const url of [firstUrl, secondUrl]) {
      await documents.updateUrlCache(SOURCE_ID, url, snapshot.id, {
        etag: '"shared"',
      });
    }
    const queue = new FakeCrawlTaskQueue();
    const service = new SourceDiscoverService(
      store,
      documents,
      new OfflineFetcherFactory({
        [firstUrl]: { status: 304 },
        [secondUrl]: { status: 304 },
      }),
      new AdapterRegistry(
        new HangzhouEducationAdapter(),
        new NingboEducationAdapter(),
        new YinzhouGovernmentAdapter(),
        new NanjingEducationAdapter(),
        new ShaoxingEducationAdapter(),
        new JiaxingEducationAdapter(),
        new SuzhouEducationAdapter(),
        new ChangzhouEducationAdapter(),
        new LishuiEducationAdapter(),
      ),
      queue,
      objects,
    );
    const run = await store.createRun({
      sourceId: SOURCE_ID,
      trigger: 'schedule',
    });
    await service.handle({
      sourceId: SOURCE_ID,
      runId: run.id,
      trigger: 'schedule',
      checkWindow: 'shared',
    });
    expect(fetchUrls(queue)).toEqual([
      'https://edu.hangzhou.gov.cn/a/detail.html',
      'https://edu.hangzhou.gov.cn/b/detail.html',
    ]);
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

  it('栏目 304 缺缓存快照时按失败处理，不掩盖缓存损坏', async () => {
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

    expect(outcome.status).toBe('failed');
    expect(prisma.sources[0].consecutiveFailures).toBe(1);
    expect(prisma.findRun(payload.runId)!.status).toBe('failed');
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
      new FakeObjectStore(),
    );
    const run = await runStore.createRun({
      sourceId: SOURCE_ID,
      trigger: 'schedule',
    });
    const payload: SourceDiscoverPayload = {
      sourceId: SOURCE_ID,
      runId: run.id,
      trigger: 'schedule',
      checkWindow: 'w-zero',
    };
    return { prisma, queue, service, payload };
  }

  it('历史来源成功抓取却 0 条 → zero_suspect：recordFailure（suspected_zero_results），不得 recordSuccess', async () => {
    const { prisma, queue, service, payload } = await setupEmptyList({
      withHistory: true,
    });

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
    const { prisma, service, payload } = await setupEmptyList({
      withHistory: true,
    });
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
    const { prisma, service, payload } = await setupEmptyList({
      withHistory: false,
    });

    const outcome = await service.handle(payload);

    expect(outcome.status).toBe('no_new');
    expect(prisma.findRun(payload.runId)!.status).toBe('no_new');
    expect(prisma.sources[0].consecutiveFailures).toBe(0);
    expect(prisma.sources[0].healthStatus).toBe('healthy');
    expect(prisma.sources[0].lastSuccessAt).not.toBeNull();
  });
});
