/**
 * v7.2 工作包 4：Worker 处理器与定时投递器测试。
 *
 * 覆盖：
 * - CrawlProcessor 任务分派（source.discover / document.fetch 真正执行）；
 * - 后续工作包任务明确记为 not_implemented（不静默成功、不误报）；
 * - 未知任务抛错（部署不一致必须显式失败，不静默丢弃）；
 * - Worker 心跳与人工暂停（CRAWL_WORKER_PAUSED）；
 * - CrawlScheduler 单来源失败隔离、重入保护、开关；
 * - 结构性保证：API 进程模块不引用 CrawlProcessor，抓取只在独立 Worker 执行。
 *
 * 全部离线：处理器依赖用内存假实现，不触网、不连 Redis。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrawlProcessor } from './crawl.worker.js';
import { CrawlScheduler } from '../crawl-scheduler.js';
import type { CrawlRunStore, SourceRecord } from '../crawl-run-store.js';
import type {
  AnnouncementExtractPayload,
  DocumentFetchPayload,
  DocumentParsePayload,
  SourceDiscoverPayload,
} from './task-queue.js';

/** 取出构造 CrawlProcessor 所需的依赖（内存替身） */
function makeProcessor() {
  const discover = {
    handle: vi.fn(
      async (): Promise<{ status: string; errorSummary?: string }> => ({
        status: 'succeeded',
      }),
    ),
  };
  const fetch = { handle: vi.fn(async () => ({ status: 'downloaded' })) };
  const parse = { handle: vi.fn(async () => ({ status: 'parsed' })) };
  const extract = { handle: vi.fn(async () => ({ status: 'pending_review' })) };
  const health = { markWorkerAlive: vi.fn(async () => {}) };
  const processor = new CrawlProcessor(
    discover as never,
    fetch as never,
    parse as never,
    extract as never,
    health as never,
  );
  return { processor, discover, fetch, parse, extract, health };
}

const discoverJob = (data: SourceDiscoverPayload) =>
  ({ name: 'source.discover', data }) as unknown as Job;
const fetchJob = (data: DocumentFetchPayload) =>
  ({ name: 'document.fetch', data }) as unknown as Job;

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRAWL_WORKER_PAUSED;
  delete process.env.CRAWL_SCHEDULER_ENABLED;
});

describe('CrawlProcessor.process（任务分派）', () => {
  it('source.discover → 交给发现处理器，并透传其返回值', async () => {
    const { processor, discover, fetch } = makeProcessor();
    const data: SourceDiscoverPayload = {
      sourceId: 'src-hz',
      runId: 'run-1',
      trigger: 'schedule',
      checkWindow: 'w1',
    };

    const result = await processor.process(discoverJob(data));

    expect(discover.handle).toHaveBeenCalledWith(data);
    expect(fetch.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'succeeded' });
  });

  it.each(['failed', 'partial'])(
    '真实 HTTP 摘要 %s → 抛错交给 BullMQ attempts 重试',
    async (status) => {
      const { processor, discover } = makeProcessor();
      discover.handle.mockResolvedValue({
        status,
        errorSummary: 'HTTP_ERROR@https://host/path:503',
      });

      await expect(
        processor.process(
          discoverJob({
            sourceId: 'src-hz',
            runId: 'run-1',
            trigger: 'schedule',
            checkWindow: 'w1',
          }),
        ),
      ).rejects.toThrow(/HTTP_ERROR/);
    },
  );

  it('有剩余 attempts 时透传上下文，耗尽时仍使用单参数调用', async () => {
    const { processor, discover, fetch } = makeProcessor();
    const discovery = {
      sourceId: 'src-hz',
      runId: 'run-1',
      trigger: 'schedule' as const,
      checkWindow: 'w1',
    };
    const document: DocumentFetchPayload = {
      sourceId: 'src-hz',
      runId: 'run-1',
      canonicalUrl: 'https://host/path',
      kind: 'announcement',
    };

    await processor.process({
      name: 'source.discover',
      data: discovery,
      opts: { attempts: 4 },
      attemptsMade: 1,
    } as unknown as Job);
    await processor.process({
      name: 'document.fetch',
      data: document,
      opts: { attempts: 4 },
      attemptsMade: 1,
    } as unknown as Job);
    await processor.process({
      name: 'source.discover',
      data: discovery,
      opts: { attempts: 2 },
      attemptsMade: 1,
    } as unknown as Job);

    expect(discover.handle).toHaveBeenNthCalledWith(1, discovery, 2);
    expect(fetch.handle).toHaveBeenCalledWith(document, 2);
    expect(discover.handle).toHaveBeenNthCalledWith(2, discovery);
  });

  it.each([
    { status: 'blocked', errorSummary: 'forbidden' },
    { status: 'structure_changed', errorSummary: 'selector missing' },
    { status: 'failed', errorSummary: 'HOST_NOT_ALLOWED:' },
    { status: 'failed', errorSummary: 'source_not_found' },
  ])('%s 不触发 BullMQ 自动重试', async (outcome) => {
    const { processor, discover } = makeProcessor();
    discover.handle.mockResolvedValue(outcome as never);
    await expect(
      processor.process(
        discoverJob({
          sourceId: 'src-hz',
          runId: 'run-1',
          trigger: 'schedule',
          checkWindow: 'w1',
        }),
      ),
    ).resolves.toEqual(outcome);
  });

  it('document.fetch → 交给下载处理器，并透传其返回值', async () => {
    const { processor, discover, fetch } = makeProcessor();
    const data: DocumentFetchPayload = {
      sourceId: 'src-hz',
      runId: 'run-1',
      canonicalUrl: 'https://edu.hangzhou.gov.cn/a.html',
      kind: 'announcement',
    };

    const result = await processor.process(fetchJob(data));

    expect(fetch.handle).toHaveBeenCalledWith(data);
    expect(discover.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'downloaded' });
  });

  it('document.parse → 交给格式解析处理器，并透传其返回值', async () => {
    const { processor, parse } = makeProcessor();
    const data: DocumentParsePayload = {
      snapshotId: 'snap-1',
      documentParserVersion: 'wp4-v1',
    };

    const result = await processor.process({
      name: 'document.parse',
      data,
    } as unknown as Job);

    expect(parse.handle).toHaveBeenCalledWith(data);
    expect(result).toEqual({ status: 'parsed' });
  });

  it('announcement.extract → 交给业务抽取处理器，并透传其返回值', async () => {
    const { processor, extract } = makeProcessor();
    const data: AnnouncementExtractPayload = {
      snapshotId: 'snap-1',
      parserVersion: 'rule-field-extractor@1.0.0',
    };

    const result = await processor.process({
      name: 'announcement.extract',
      data,
    } as unknown as Job);

    expect(extract.handle).toHaveBeenCalledWith(data);
    expect(result).toEqual({ status: 'pending_review' });
  });

  it('catalog.project → 明确记为 not_implemented（不误报成功）', async () => {
    const { processor } = makeProcessor();

    const result = await processor.process({
      name: 'catalog.project',
      data: {},
    } as unknown as Job);

    expect(result).toEqual({
      status: 'not_implemented',
      name: 'catalog.project',
    });
  });

  it('未知任务 → 抛错（部署不一致必须显式失败，不静默丢弃）', async () => {
    const { processor } = makeProcessor();
    await expect(
      processor.process({ name: 'bogus.task', data: {} } as unknown as Job),
    ).rejects.toThrow(/未知抓取任务/);
  });
});

describe('CrawlProcessor 生命周期（心跳与人工暂停）', () => {
  it('onModuleInit 写入 Worker 心跳；销毁后停止心跳', async () => {
    vi.useFakeTimers();
    const { processor, health } = makeProcessor();

    await processor.onModuleInit();
    expect(health.markWorkerAlive).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(health.markWorkerAlive.mock.calls.length).toBeGreaterThanOrEqual(3);

    const before = health.markWorkerAlive.mock.calls.length;
    processor.onModuleDestroy();
    vi.advanceTimersByTime(30_000);
    expect(health.markWorkerAlive.mock.calls.length).toBe(before);
  });

  it('CRAWL_WORKER_PAUSED=true → 暂停消费但仍写心跳（进程在线可观测）', async () => {
    process.env.CRAWL_WORKER_PAUSED = 'true';
    const { processor, health } = makeProcessor();
    // 模拟 bull.explorer 注入的底层 worker
    const pause = vi.fn(async () => {});
    (processor as unknown as { _worker: unknown })._worker = { pause };

    await processor.onModuleInit();

    expect(pause).toHaveBeenCalledTimes(1);
    expect(health.markWorkerAlive).toHaveBeenCalledTimes(1);
    processor.onModuleDestroy();
  });
});

/** ---------- CrawlScheduler ---------- */

const dueSource = (id: string): SourceRecord =>
  ({
    id,
    publisher: id,
    officialUrl: `https://${id}.example.gov.cn/`,
    enabled: true,
    adapterKey: 'hangzhou-education',
    listUrls: null,
    allowedHosts: null,
    pollEveryMinutes: 60,
    nextCheckAt: null,
    healthStatus: 'healthy',
    consecutiveFailures: 0,
    lastCheckedAt: null,
    etag: null,
    lastModified: null,
  }) satisfies SourceRecord;

function makeScheduler(
  sources: SourceRecord[],
  check: (id: string) => Promise<unknown>,
) {
  const orchestrator = { checkSource: vi.fn(check) };
  const store = { listDueSources: vi.fn(async () => sources) };
  const scheduler = new CrawlScheduler(
    orchestrator as never,
    store as unknown as CrawlRunStore,
  );
  return { scheduler, orchestrator, store };
}

describe('CrawlScheduler.tick（定时投递）', () => {
  it('到期来源逐个按 schedule 触发投递', async () => {
    const { scheduler, orchestrator } = makeScheduler(
      [dueSource('a'), dueSource('b')],
      async () => ({ status: 'queued' }),
    );

    await scheduler.tick();

    expect(orchestrator.checkSource).toHaveBeenCalledTimes(2);
    expect(orchestrator.checkSource).toHaveBeenCalledWith('a', 'schedule');
    expect(orchestrator.checkSource).toHaveBeenCalledWith('b', 'schedule');
  });

  it('单来源失败隔离：一个来源抛错不中断其他来源投递', async () => {
    const { scheduler, orchestrator } = makeScheduler(
      [dueSource('bad'), dueSource('good')],
      async (id) => {
        if (id === 'bad') throw new Error('boom');
        return { status: 'queued' };
      },
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();
    // 抛错来源之后的来源仍被投递（失败被隔离）
    expect(orchestrator.checkSource).toHaveBeenCalledWith('good', 'schedule');
    expect(orchestrator.checkSource).toHaveBeenCalledTimes(2);
  });

  it('重入保护：上一轮未结束时本轮直接跳过，不叠加投递', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { scheduler, orchestrator } = makeScheduler(
      [dueSource('a')],
      async () => {
        await blocked;
        return { status: 'queued' };
      },
    );

    const first = scheduler.tick();
    const second = scheduler.tick(); // 立即返回，不重复扫描
    release();
    await Promise.all([first, second]);

    expect(orchestrator.checkSource).toHaveBeenCalledTimes(1);
  });

  it('CRAWL_SCHEDULER_ENABLED=false → 关闭定时投递（仅手动运维）', async () => {
    process.env.CRAWL_SCHEDULER_ENABLED = 'false';
    const { scheduler, orchestrator, store } = makeScheduler(
      [dueSource('a')],
      async () => ({ status: 'queued' }),
    );

    await scheduler.tick();

    expect(orchestrator.checkSource).not.toHaveBeenCalled();
    expect(store.listDueSources).not.toHaveBeenCalled();
  });

  it('扫描到期来源本身抛错也不让进程崩溃', async () => {
    const orchestrator = { checkSource: vi.fn() };
    const store = {
      listDueSources: vi.fn(async () => {
        throw new Error('db down');
      }),
    };
    const scheduler = new CrawlScheduler(
      orchestrator as never,
      store as unknown as CrawlRunStore,
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(orchestrator.checkSource).not.toHaveBeenCalled();
  });
});

/** ---------- 结构性保证：API 主进程不执行耗时解析 ---------- */

function readSource(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    'utf8',
  );
}

describe('拓扑分离（静态保证）', () => {
  it('API 侧模块（core / sourcing / app）不引用 CrawlProcessor 或 crawl.worker', () => {
    for (const file of [
      '../sourcing-core.module.ts',
      '../sourcing.module.ts',
      '../../app.module.ts',
    ]) {
      const text = readSource(file);
      expect(text, file).not.toMatch(/CrawlProcessor/);
      expect(text, file).not.toMatch(/crawl\.worker/);
    }
  });

  it('API 根模块装配 SourcingModule，不装配 SourcingWorkerModule', () => {
    const app = readSource('../../app.module.ts');
    expect(app).toMatch(/SourcingModule/);
    expect(app).not.toMatch(/SourcingWorkerModule/);
  });

  it('Worker 根模块装配 SourcingWorkerModule，且 Worker 模块注册 CrawlProcessor', () => {
    const workerApp = readSource('../../worker-app.module.ts');
    const workerModule = readSource('../sourcing-worker.module.ts');
    expect(workerApp).toMatch(/SourcingWorkerModule/);
    expect(workerModule).toMatch(/CrawlProcessor/);
    expect(workerModule).toMatch(/crawl\.worker/);
  });
});
