/**
 * 运行链路联调（离线）：调度 → 投递 → Worker → 发现 → 失败重试 → 告警 → 恢复。
 *
 * 背景（N1/N2/N3 账本 8.2）：自动发现、正文、附件、去重已有真实样本回放证据，
 * 但「失败重试、告警、调度投递」属运行链路，此前没有串起来的验证。
 *
 * 本文件用真实组件（CrawlScheduler、CrawlOrchestrator、CrawlRunStore、
 * SourcingAlertService、SourceDiscoverService、CrawlProcessor、南昌适配器）
 * 串起同一条链路，只替换外部基础设施：
 * - FakePrisma：内存持久化（含 sourcing_alert 表语义）；
 * - FakeCrawlTaskQueue：内存队列（模拟 BullMQ 幂等与重投）；
 * - OfflineFetcherFactory：南昌真实样本回放 + 按调用次数注入 503 / 结构漂移。
 *
 * 口径纪律：本文件证明“代码链路在注入故障下按预期重试、退避、告警与恢复”，
 * **不等于**真实 PostgreSQL/Redis 调度已跑通，也不代表 7 天观察完成。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from './adapter-registry.js';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlRunStore } from './crawl-run-store.js';
import { CrawlScheduler } from './crawl-scheduler.js';
import { SourcingAlertService } from './sourcing-alert.service.js';
import { SourceDocumentStore } from './source-document-store.js';
import { CrawlProcessor } from './jobs/crawl.worker.js';
import { SourceDiscoverService } from './jobs/source-discover.service.js';
import { NanchangEducationAdapter } from './adapters/nanchang-education.adapter.js';
import type { OfficialSiteAdapter } from './official-site-adapter.js';
import type { SourceDiscoverPayload } from './jobs/task-queue.js';
import {
  FakeCrawlTaskQueue,
  FakeObjectStore,
  FakePrisma,
  OfflineFetcherFactory,
  type OfflineResponder,
  type OfflineRoute,
} from './testing/crawl-testing.js';

const LIST_1 = 'https://edu.nc.gov.cn/ncjyj/jskfw/nav_list.shtml';
const LIST_2 = 'https://edu.nc.gov.cn/ncjyj/jskfw/nav_list_2.shtml';
const SOURCE_ID = 'src-nanchang';

function golden(name: string): string {
  return readFileSync(
    fileURLToPath(
      new URL(
        `../../../tests/fixtures/golden-sources/nanchang/${name}`,
        import.meta.url,
      ),
    ),
    'utf8',
  );
}

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };

function ok(body: string): Response {
  return new Response(body, { status: 200, headers: HTML_HEADERS });
}

function status(code: number): Response {
  return new Response('busy', { status: code, headers: HTML_HEADERS });
}

/** 内存链路：真实组件 + 可注入故障的离线抓取。 */
function buildChain(routes: OfflineRoute, responder?: OfflineResponder) {
  const prisma = new FakePrisma();
  const source = prisma.seedSource({
    id: SOURCE_ID,
    publisher: '南昌市教育局',
    officialUrl: LIST_1,
    adapterKey: 'nanchang-education',
    listUrls: [LIST_1],
    allowedHosts: ['edu.nc.gov.cn'],
    pollEveryMinutes: 60,
    // 到期：调度 tick 应当选中该来源
    nextCheckAt: new Date(Date.now() - 60_000),
  });
  const alerts = new SourcingAlertService(prisma as never);
  const runStore = new CrawlRunStore(prisma as never, undefined, alerts);
  const documentStore = new SourceDocumentStore(prisma as never);
  const queue = new FakeCrawlTaskQueue();
  // 注册表按位置接收旧适配器；本用例只关心南昌，用类型收窄避免伪造 9 个实例
  const Registry = AdapterRegistry as unknown as new (
    ...adapters: OfficialSiteAdapter[]
  ) => AdapterRegistry;
  const registry = new Registry(new NanchangEducationAdapter());
  const factory = new OfflineFetcherFactory(routes, {}, [], responder);
  const discover = new SourceDiscoverService(
    runStore,
    documentStore,
    factory,
    registry,
    queue,
    new FakeObjectStore(),
  );
  const orchestrator = new CrawlOrchestrator(runStore, queue);
  const scheduler = new CrawlScheduler(orchestrator, runStore, alerts);
  const processor = new CrawlProcessor(
    discover,
    { handle: async () => ({ status: 'downloaded' }) } as never,
    { handle: async () => ({ status: 'parsed' }) } as never,
    { handle: async () => ({ status: 'pending_review' }) } as never,
    { markWorkerAlive: async () => {} } as never,
  );
  return {
    prisma,
    source,
    alerts,
    queue,
    discover,
    orchestrator,
    scheduler,
    processor,
  };
}

function discoverJob(
  payload: SourceDiscoverPayload,
  attemptsMade = 0,
  attempts = 1,
): Job {
  return {
    name: 'source.discover',
    data: payload,
    opts: { attempts },
    attemptsMade,
  } as unknown as Job;
}

/** 第一次投递的发现任务载荷（避免依赖 jobId 生成细节） */
function firstDiscoverPayload(queue: FakeCrawlTaskQueue): SourceDiscoverPayload {
  const job = queue.enqueued.find((item) => item.name === 'source.discover');
  expect(job).toBeDefined();
  return job!.payload as SourceDiscoverPayload;
}

function nextCheckGapMinutes(row: Record<string, unknown>): number {
  const checkedAt = (row.lastCheckedAt as Date).getTime();
  const next = (row.nextCheckAt as Date).getTime();
  return Math.round((next - checkedAt) / 60_000);
}

describe('运行链路：调度投递与真实样本发现', () => {
  it('到期来源被调度投递 → Worker 发现 34 条南昌公告并投递下载任务', async () => {
    const routes: OfflineRoute = {
      [LIST_1]: golden('public-list-1.html'),
      [LIST_2]: golden('public-list-2.html'),
    };
    const chain = buildChain(routes);

    await chain.scheduler.tick();
    expect(chain.queue.count('source.discover')).toBe(1);
    const payload = firstDiscoverPayload(chain.queue);
    expect(payload.trigger).toBe('schedule');

    // 同一调度窗口内重复检查：复用进行中运行，不再投递
    const again = await chain.orchestrator.checkSource(SOURCE_ID, 'schedule');
    expect(again.status).toBe('already_running');
    expect(again.deduplicated).toBe(true);
    expect(chain.queue.count('source.discover')).toBe(1);

    const outcome = (await chain.processor.process(discoverJob(payload))) as {
      status: string;
      discoveredCount: number;
    };
    expect(outcome.status).toBe('succeeded');
    expect(outcome.discoveredCount).toBe(34);
    expect(chain.queue.count('document.fetch')).toBe(34);

    const run = chain.prisma.findRun(payload.runId)!;
    expect(run.fetchAudit).toMatchObject({
      discovery: { status: 'succeeded', count: 34, failed: 0 },
    });
    // 下载尚未执行：运行保持 running，不提前记成功
    expect(run.status).toBe('running');

    expect(chain.source.healthStatus).toBe('healthy');
    expect(chain.source.consecutiveFailures).toBe(0);
    expect(chain.source.lastSuccessAt).toBeInstanceOf(Date);
  });
});

describe('运行链路：失败重试与退避', () => {
  it('瞬时 503 先记 retrying 并按指数退避，第二次尝试恢复成功', async () => {
    // 首次处理内 SafeFetcher 自身会重试 3 次；之后恢复正常
    let failuresLeft = 3;
    const responder: OfflineResponder = (url) => {
      if (url === LIST_1) {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          return status(503);
        }
        return ok(golden('public-list-1.html'));
      }
      if (url === LIST_2) return ok(golden('public-list-2.html'));
      return status(404);
    };
    const chain = buildChain({}, responder);

    const queued = await chain.orchestrator.checkSource(SOURCE_ID, 'admin');
    expect(queued.status).toBe('queued');
    const payload = chain.queue.payloadOf<SourceDiscoverPayload>(
      queued.jobId!,
    )!;

    // 第 1 次尝试（attempts=3）：失败 → 抛错交给 BullMQ 重投
    await expect(
      chain.processor.process(discoverJob(payload, 0, 3)),
    ).rejects.toThrow(/HTTP_ERROR/);

    const run = chain.prisma.findRun(queued.runId)!;
    expect(run.fetchAudit).toMatchObject({
      discovery: { status: 'retrying' },
    });
    expect(chain.source.consecutiveFailures).toBe(1);
    expect(nextCheckGapMinutes(chain.source)).toBe(60);

    // 第 2 次尝试（attemptsMade=1）：恢复正常 → 成功
    const retried = (await chain.processor.process(
      discoverJob(payload, 1, 3),
    )) as { status: string; discoveredCount: number };
    expect(retried.status).toBe('succeeded');
    expect(retried.discoveredCount).toBe(34);
    expect(chain.source.healthStatus).toBe('healthy');
    expect(chain.source.consecutiveFailures).toBe(0);
  });

  it('连续失败达阈值 → 告警并降级，退避递增（1x/2x/4x）', async () => {
    let failing = true;
    const responder: OfflineResponder = (url) => {
      if (failing) return status(503);
      if (url === LIST_1) return ok(golden('public-list-1.html'));
      if (url === LIST_2) return ok(golden('public-list-2.html'));
      return status(404);
    };
    const chain = buildChain({}, responder);

    const failureRounds = [60, 120, 240];
    for (let round = 0; round < failureRounds.length; round += 1) {
      const queued = await chain.orchestrator.checkSource(
        SOURCE_ID,
        'admin',
        { nonce: `fail-${round}` },
      );
      const payload = chain.queue.payloadOf<SourceDiscoverPayload>(
        queued.jobId!,
      )!;
      await expect(chain.processor.process(discoverJob(payload))).rejects.toThrow(
        /HTTP_ERROR/,
      );
      expect(chain.source.consecutiveFailures).toBe(round + 1);
      expect(nextCheckGapMinutes(chain.source)).toBe(failureRounds[round]);
    }

    expect(chain.source.healthStatus).toBe('degraded');
    const alert = chain.prisma.alerts.find(
      (item) => item.type === 'consecutive_failures',
    )!;
    expect(alert).toBeDefined();
    expect(alert.resolvedAt).toBeNull();
    expect(alert.occurrences).toBe(1);
    expect(String(alert.message)).toContain('连续失败 3 次');

    // 恢复成功 → 健康恢复且告警自动解除（历史保留）
    failing = false;
    const recovered = await chain.orchestrator.checkSource(
      SOURCE_ID,
      'admin',
      { nonce: 'recover' },
    );
    const payload = chain.queue.payloadOf<SourceDiscoverPayload>(
      recovered.jobId!,
    )!;
    const success = (await chain.processor.process(discoverJob(payload))) as {
      status: string;
    };
    expect(success.status).toBe('succeeded');
    expect(chain.source.healthStatus).toBe('healthy');
    expect(chain.source.consecutiveFailures).toBe(0);
    expect(alert.resolvedAt).not.toBeNull();
  });
});

describe('运行链路：结构漂移告警与恢复', () => {
  it('列表 DOM 改版 → structure_changed 告警；恢复后自动解除', async () => {
    const drift = '<html><body><div class="changed">栏目改版中</div></body></html>';
    const routes: OfflineRoute = { [LIST_1]: drift };
    const chain = buildChain(routes);

    const queued = await chain.orchestrator.checkSource(SOURCE_ID, 'schedule');
    const payload = chain.queue.payloadOf<SourceDiscoverPayload>(
      queued.jobId!,
    )!;
    const drifted = (await chain.processor.process(discoverJob(payload))) as {
      status: string;
    };
    expect(drifted.status).toBe('structure_changed');
    expect(chain.source.healthStatus).toBe('structure_changed');
    const alert = chain.prisma.alerts.find(
      (item) => item.type === 'structure_changed',
    )!;
    expect(alert).toBeDefined();
    expect(alert.resolvedAt).toBeNull();
    expect(chain.prisma.findRun(queued.runId)!.status).toBe('structure_changed');

    // 官方模板恢复：同一来源的下一轮成功发现，告警自动解除
    routes[LIST_1] = golden('public-list-1.html');
    routes[LIST_2] = golden('public-list-2.html');

    const recovered = await chain.orchestrator.checkSource(SOURCE_ID, 'admin', {
      nonce: 'after-drift',
    });
    const recoveredPayload = chain.queue.payloadOf<SourceDiscoverPayload>(
      recovered.jobId!,
    )!;
    const outcome = (await chain.processor.process(
      discoverJob(recoveredPayload),
    )) as { status: string; discoveredCount: number };
    expect(outcome.status).toBe('succeeded');
    expect(outcome.discoveredCount).toBe(34);
    expect(chain.source.healthStatus).toBe('healthy');
    expect(alert.resolvedAt).not.toBeNull();
  });
});
