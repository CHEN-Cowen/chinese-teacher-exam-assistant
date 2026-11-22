/**
 * 下载阶段预算：入队与执行双重校验、重试计入请求预算、停止后不再派生。
 */
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter-registry.js';
import { HangzhouEducationAdapter } from '../adapters/hangzhou-education.adapter.js';
import { CrawlRunStore } from '../crawl-run-store.js';
import { SourceDocumentStore } from '../source-document-store.js';
import {
  TRIAL_BUDGET_DEFAULTS,
  type TrialBudgetLimits,
} from '../crawl-budget.js';
import { DocumentFetchService } from './document-fetch.service.js';
import { isTransientFetchFailure, type DocumentFetchPayload } from './task-queue.js';
import {
  FakeCrawlTaskQueue,
  FakeObjectStore,
  FakePrisma,
  InMemoryCrawlBudgetStore,
  OfflineFetcherFactory,
  type OfflineResponder,
  type OfflineRoute,
} from '../testing/crawl-testing.js';

const LIST_URL = 'https://edu.hangzhou.gov.cn/col/col123/index.html';
const DETAIL_A =
  'https://edu.hangzhou.gov.cn/art/2026/11/20/art_1_1.html';
const DETAIL_B =
  'https://edu.hangzhou.gov.cn/art/2026/11/21/art_1_2.html';
const SOURCE_ID = 'src-hz-budget';

function detailHtml(url: string, attachmentCount: number): string {
  const dir = url.slice(0, url.lastIndexOf('/'));
  const links = Array.from(
    { length: attachmentCount },
    (_value, index) =>
      `<a href="${dir}/job${index + 1}.xlsx">附件${index + 1}.xlsx</a>`,
  ).join('');
  return `<html><head><meta name="ArticleTitle" content="2026年教师招聘公告"><meta name="PubDate" content="2026-11-20"></head><body><div class="j-fontContent"><p>正文内容用于验证附件预算。</p>${links}</div></body></html>`;
}

function attachmentUrls(url: string, count: number): string[] {
  const dir = url.slice(0, url.lastIndexOf('/'));
  return Array.from(
    { length: count },
    (_value, index) => `${dir}/job${index + 1}.xlsx`,
  );
}

async function setup(options: {
  limits?: TrialBudgetLimits | null;
  routes?: OfflineRoute;
  responder?: OfflineResponder;
  admit?: string[];
}) {
  const prisma = new FakePrisma();
  prisma.seedSource({
    id: SOURCE_ID,
    publisher: '杭州市教育局',
    officialUrl: LIST_URL,
    adapterKey: 'hangzhou-education',
    allowedHosts: ['edu.hangzhou.gov.cn'],
  });
  const queue = new FakeCrawlTaskQueue();
  const factory = new OfflineFetcherFactory(
    options.routes ?? {},
    {},
    [],
    options.responder,
  );
  const budget = new InMemoryCrawlBudgetStore();
  const runStore = new CrawlRunStore(prisma as never);
  const service = new DocumentFetchService(
    runStore,
    new SourceDocumentStore(prisma as never),
    new FakeObjectStore(),
    factory,
    new AdapterRegistry(new HangzhouEducationAdapter()),
    queue,
    undefined,
    budget as never,
  );
  const run = await runStore.createRun({ sourceId: SOURCE_ID, trigger: 'admin' });
  if (options.limits) {
    await budget.create(run.id, SOURCE_ID, options.limits);
  }
  for (const url of options.admit ?? []) {
    await budget.admitDocument(run.id, url);
  }
  const payloadFor = (canonicalUrl: string): DocumentFetchPayload => ({
    sourceId: SOURCE_ID,
    runId: run.id,
    canonicalUrl,
    kind: 'announcement',
  });
  return {
    prisma,
    queue,
    factory,
    budget,
    service,
    runId: run.id,
    payload: payloadFor(DETAIL_A),
    payloadFor,
  };
}

function fetchJobs(queue: FakeCrawlTaskQueue): string[] {
  return queue.enqueued
    .filter((job) => job.name === 'document.fetch')
    .map(
      (job) =>
        (queue.jobs.get(job.jobId)!.payload as { canonicalUrl: string })
          .canonicalUrl,
    );
}

function parseJobs(queue: FakeCrawlTaskQueue): number {
  return queue.enqueued.filter((job) => job.name === 'document.parse').length;
}

describe('DocumentFetchService 试跑预算', () => {
  it('附件受每篇与整轮双限额约束，超出部分标记为未覆盖', async () => {
    const { service, budget, queue, runId, payloadFor } = await setup({
      limits: {
        maxListPages: 1,
        maxDetails: 3,
        maxAttachmentsPerDocument: 2,
        maxAttachmentsTotal: 3,
        maxHttpRequests: 20,
      },
      routes: {
        [DETAIL_A]: { status: 200, body: detailHtml(DETAIL_A, 4) },
        [DETAIL_B]: { status: 200, body: detailHtml(DETAIL_B, 4) },
      },
      admit: [DETAIL_A, DETAIL_B],
    });

    await service.handle(payloadFor(DETAIL_A));
    await service.handle(payloadFor(DETAIL_B));

    const snapshot = (await budget.get(runId))!;
    expect(snapshot.attachmentsUsed).toBe(3);
    expect(snapshot.attachmentsDeferred).toBe(5);
    expect(fetchJobs(queue)).toHaveLength(3);
    // 每篇最多 2：第一篇正好 2，第二篇只有 1
    expect(
      fetchJobs(queue).filter((url) => url.includes('/11/20/job')),
    ).toHaveLength(2);
    expect(
      fetchJobs(queue).filter((url) => url.includes('/11/21/job')),
    ).toHaveLength(1);
  });

  it('重试计入 HTTP 请求预算：额度用尽即停止重试，不发第 3 次请求', async () => {
    let attempts = 0;
    const { service, budget, factory, payload, runId } = await setup({
      // 直接构造小预算：校验器要求 ≥10，但这里验证的是执行闸门
      limits: { ...TRIAL_BUDGET_DEFAULTS, maxHttpRequests: 2 },
      responder: async () => {
        attempts += 1;
        return new Response('busy', { status: 503 });
      },
      admit: [DETAIL_A],
    });

    const outcome = await service.handle(payload);

    expect(outcome).toMatchObject({
      status: 'skipped',
      errorSummary: 'budget_http_exhausted',
    });
    expect(attempts).toBe(2);
    expect(factory.calls).toHaveLength(2);
    expect((await budget.get(runId))!.httpRequestsUsed).toBe(2);
    expect(isTransientFetchFailure(outcome.errorSummary!)).toBe(false);
  });

  it('未准入的直接投递不访问网络', async () => {
    const { service, factory, payload } = await setup({
      limits: TRIAL_BUDGET_DEFAULTS,
      routes: { [DETAIL_A]: { status: 200, body: detailHtml(DETAIL_A, 1) } },
    });

    const outcome = await service.handle(payload);

    expect(outcome).toMatchObject({
      status: 'skipped',
      errorSummary: 'budget_not_admitted',
    });
    expect(factory.calls).toHaveLength(0);
  });

  it('停止后待执行任务跳过：不发 HTTP、不派生附件/解析', async () => {
    const context = await setup({
      limits: TRIAL_BUDGET_DEFAULTS,
      routes: { [DETAIL_A]: { status: 200, body: detailHtml(DETAIL_A, 2) } },
      admit: [DETAIL_A],
    });
    await context.budget.stop(context.runId, 'stopped_by_admin');

    const outcome = await context.service.handle(context.payload);

    expect(outcome).toMatchObject({
      status: 'skipped',
      errorSummary: 'run_stopped',
    });
    expect(context.factory.calls).toHaveLength(0);
    expect(fetchJobs(context.queue)).toHaveLength(0);
    expect(parseJobs(context.queue)).toBe(0);
  });

  it('执行中被停止：本次请求收尾但不再派生附件与解析任务', async () => {
    let stopRun: (() => Promise<void>) | null = null;
    const context = await setup({
      limits: TRIAL_BUDGET_DEFAULTS,
      responder: async (url) => {
        if (url === DETAIL_A && stopRun) await stopRun();
        return new Response(detailHtml(DETAIL_A, 3), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      },
      admit: [DETAIL_A],
    });
    stopRun = async () => {
      await context.budget.stop(context.runId, 'manual_stop');
    };

    const outcome = await context.service.handle(context.payload);

    expect(outcome.status).toBe('downloaded');
    expect(fetchJobs(context.queue)).toHaveLength(0);
    expect(parseJobs(context.queue)).toBe(0);
    expect((await context.budget.get(context.runId))!.status).toBe('stopped');
  });

  it('重复投递同一任务：不重复占用附件额度，队列幂等吸收重复任务', async () => {
    const { service, budget, queue, runId, payload } = await setup({
      limits: TRIAL_BUDGET_DEFAULTS,
      routes: { [DETAIL_A]: { status: 200, body: detailHtml(DETAIL_A, 2) } },
      admit: [DETAIL_A],
    });

    await service.handle(payload);
    await service.handle(payload);

    const snapshot = (await budget.get(runId))!;
    expect(snapshot.attachmentsUsed).toBe(2);
    expect(snapshot.detailsUsed).toBe(1);
    expect(new Set(fetchJobs(queue)).size).toBe(2);
    // 两次实际正文请求都计入请求预算
    expect(snapshot.httpRequestsUsed).toBe(2);
    expect(attachmentUrls(DETAIL_A, 2)).toEqual(fetchJobs(queue).sort());
  });
});
