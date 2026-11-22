/**
 * 发现阶段预算：列表/详情额度、历史与新发现共用详情额度、重放不绕过、停止即停。
 */
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter-registry.js';
import { BengbuEducationAdapter } from '../adapters/bengbu-education.adapter.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import {
  TRIAL_BUDGET_DEFAULTS,
  type TrialBudgetLimits,
} from '../crawl-budget.js';
import { SourceDiscoverService } from './source-discover.service.js';
import type { SourceDiscoverPayload } from './task-queue.js';
import {
  FakeCrawlTaskQueue,
  FakeObjectStore,
  FakePrisma,
  InMemoryCrawlBudgetStore,
  OfflineFetcherFactory,
  type OfflineRoute,
} from '../testing/crawl-testing.js';

const LIST_URL = 'https://jyj.bengbu.gov.cn/xwdt/kszp/';
const SOURCE_ID = 'src-bengbu-trial';
const PAGE_SIZE = 9;
const PAGE_COUNT = 18;

/** 来源配置里登记的 18 个栏目页（首页 + 17 个分页），用于验证列表额度 */
function paginatedListUrls(): string[] {
  return [
    LIST_URL,
    ...Array.from(
      { length: PAGE_COUNT - 1 },
      (_value, index) =>
        `https://jyj.bengbu.gov.cn/content/column/6820881?pageIndex=${index + 2}`,
    ),
  ];
}

function routesForAllPages(): OfflineRoute {
  const routes: OfflineRoute = {};
  for (const url of paginatedListUrls()) {
    routes[url] = { status: 200, body: listHtml() };
  }
  return routes;
}

/** 服务端渲染列表：9 条/页 + 官方 pageCount 声明 18 页 */
function listHtml(): string {
  const items = Array.from({ length: PAGE_SIZE }, (_value, index) => {
    const id = `10000000${index + 1}`;
    return `<li><a href="/xwdt/kszp/${id}.html" title="2026年蚌埠教师招聘公告${index + 1}">公告${index + 1}</a><span class="right date">2026-11-0${index + 1}</span></li>`;
  }).join('');
  return `<html><body><ul>${items}</ul><script>Ls.pagination({pageCount:${PAGE_COUNT},pageIndex:1});</script></body></html>`;
}

async function setup(options: {
  limits?: TrialBudgetLimits | null;
  routes?: OfflineRoute;
  responder?: Parameters<typeof OfflineFetcherFactory>[3];
  knownDocuments?: number;
  knownAttachments?: number;
  listUrls?: string[];
}) {
  const prisma = new FakePrisma();
  prisma.seedSource({
    id: SOURCE_ID,
    publisher: '蚌埠市教育局',
    officialUrl: LIST_URL,
    listUrls: options.listUrls ?? paginatedListUrls(),
    adapterKey: 'bengbu-education',
    allowedHosts: ['jyj.bengbu.gov.cn'],
  });
  for (let index = 0; index < (options.knownDocuments ?? 0); index += 1) {
    prisma.seedDocument({
      sourceId: SOURCE_ID,
      canonicalUrl: `https://jyj.bengbu.gov.cn/xwdt/kszp/90000${index}.html`,
      kind: 'announcement',
    });
  }
  for (let index = 0; index < (options.knownAttachments ?? 0); index += 1) {
    prisma.seedDocument({
      sourceId: SOURCE_ID,
      canonicalUrl: `https://jyj.bengbu.gov.cn/group4/attach/old${index}.pdf`,
      kind: 'attachment',
    });
  }

  const queue = new FakeCrawlTaskQueue();
  const runStore = new CrawlRunStore(prisma as never);
  const documentStore = new SourceDocumentStore(prisma as never);
  const budget = new InMemoryCrawlBudgetStore();
  const factory = new OfflineFetcherFactory(
    options.routes ?? {},
    {},
    [],
    options.responder,
  );
  const service = new SourceDiscoverService(
    runStore,
    documentStore,
    factory,
    new AdapterRegistry(new BengbuEducationAdapter()),
    queue,
    new FakeObjectStore(),
    undefined,
    budget as never,
  );
  const run = await runStore.createRun({ sourceId: SOURCE_ID, trigger: 'admin' });
  if (options.limits) {
    await budget.create(run.id, SOURCE_ID, options.limits);
  }
  const payload: SourceDiscoverPayload = {
    sourceId: SOURCE_ID,
    runId: run.id,
    trigger: 'admin',
    checkWindow: `trial-${run.id}`,
  };
  return { prisma, queue, factory, budget, service, payload, run };
}

function fetchJobUrls(queue: FakeCrawlTaskQueue): string[] {
  return queue.enqueued
    .filter((job) => job.name === 'document.fetch')
    .map(
      (job) =>
        (queue.jobs.get(job.jobId)!.payload as { canonicalUrl: string })
          .canonicalUrl,
    );
}

describe('SourceDiscoverService 试跑预算', () => {
  it('1 页列表 / 3 篇详情：历史与新发现共用额度，未准入内容明确标记', async () => {
    const { service, payload, queue, factory, budget, prisma } = await setup({
      limits: TRIAL_BUDGET_DEFAULTS,
      routes: routesForAllPages(),
      knownDocuments: 5,
      knownAttachments: 2,
    });

    const outcome = await service.handle(payload);

    // 只抓 1 页：派生出的 17 个分页一个都没请求
    expect(factory.calls).toEqual([LIST_URL]);
    const snapshot = (await budget.get(payload.runId))!;
    expect(snapshot.listPagesUsed).toBe(1);
    expect(snapshot.listPagesDeferred).toBe(PAGE_COUNT - 1);

    // 详情额度 3：新发现的 9 条优先占用，历史 5 条全部未准入
    expect(snapshot.detailsUsed).toBe(3);
    expect(snapshot.detailsDeferred).toBe(6 + 5);
    expect(fetchJobUrls(queue)).toHaveLength(3);
    expect(fetchJobUrls(queue)[0]).toContain('/100000001.html');

    // 结果标记为预算内部分覆盖，且不能报“零结果/结构变化”
    expect(outcome.status).toBe('partial_budget');
    expect(outcome.coverage).toBe('partial_budget');
    expect(outcome.errorSummary).toContain('budget_deferred');
    expect(snapshot.remaining.details).toBe(0);
    expect(snapshot.remaining.listPages).toBe(0);

    const run = prisma.runs[0] as unknown as {
      fetchAudit: {
        discovery: { status: string };
        budget: { detailsUsed: number };
        urls: Record<string, { status: string; error?: string }>;
      };
    };
    expect(run.fetchAudit.discovery.status).toBe('partial_budget');
    expect(run.fetchAudit.budget.detailsUsed).toBe(3);
    // 未准入的公告在账本里是 skipped，不是消失，也不是失败
    const skipped = Object.values(run.fetchAudit.urls).filter(
      (entry) => entry.status === 'skipped',
    );
    expect(skipped).toHaveLength(11);
    expect(skipped.every((entry) => entry.error === 'budget_deferred')).toBe(
      true,
    );
  });

  it('同一运行重放：不新增任务、不重复占用额度', async () => {
    const { service, payload, queue, budget } = await setup({
      limits: TRIAL_BUDGET_DEFAULTS,
      routes: routesForAllPages(),
      knownDocuments: 5,
    });

    await service.handle(payload);
    const firstJobs = fetchJobUrls(queue).length;
    const firstSnapshot = (await budget.get(payload.runId))!;

    await service.handle(payload);

    expect(fetchJobUrls(queue)).toHaveLength(firstJobs);
    const replayed = (await budget.get(payload.runId))!;
    expect(replayed.detailsUsed).toBe(firstSnapshot.detailsUsed);
    // 列表额度已用尽，重放连列表请求都不会再发
    expect(replayed.listPagesUsed).toBe(firstSnapshot.listPagesUsed);
    expect(queue.enqueued.filter((job) => job.name === 'document.fetch')).toHaveLength(
      firstJobs,
    );
  });

  it('发现过程中被停止：不再请求下一页、不投递任何下载任务', async () => {
    let stopRun: (() => Promise<void>) | null = null;
    const context = await setup({
      limits: { ...TRIAL_BUDGET_DEFAULTS, maxListPages: 2 },
      responder: async () => {
        // 第一页请求返回前按 runId 停止
        if (stopRun) await stopRun();
        return new Response(listHtml(), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
    });
    stopRun = async () => {
      await context.budget.stop(context.payload.runId, 'manual_stop');
    };

    const outcome = await context.service.handle(context.payload);

    expect(outcome.status).toBe('stopped');
    expect(context.factory.calls).toHaveLength(1);
    expect(
      context.queue.enqueued.filter((job) => job.name === 'document.fetch'),
    ).toHaveLength(0);
    expect((await context.budget.get(context.payload.runId))!.status).toBe(
      'stopped',
    );
  });

  it('没有预算行的常规运行保持原行为：会派生分页', async () => {
    const { service, payload, queue, factory } = await setup({
      limits: null,
      routes: routesForAllPages(),
      knownDocuments: 5,
    });

    const outcome = await service.handle(payload);

    expect(outcome.coverage).toBe('full');
    // 18 页全部尝试（后续页未配置路由 → 404，但请求确实发了）
    expect(factory.calls.length).toBe(PAGE_COUNT);
    // 9 条发现 + 5 条历史公告全部恢复检查
    expect(fetchJobUrls(queue)).toHaveLength(PAGE_SIZE + 5);
  });
});
