/**
 * M02/F3：定时投递器测试。
 *
 * 覆盖：到期来源投递并推进 nextCheckAt、未到期不重复投递、
 * 重启（新实例、状态来自持久化 Source 表）后按 nextCheckAt 续跑不重复
 * 产生业务记录、告警巡检（sweep）先行且失败不阻塞投递、总开关关闭。
 */
import { describe, expect, it, vi } from 'vitest';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlRunStore } from './crawl-run-store.js';
import { CrawlScheduler } from './crawl-scheduler.js';
import { FakeCrawlTaskQueue, FakePrisma } from './testing/crawl-testing.js';

function setup() {
  const prisma = new FakePrisma();
  const queue = new FakeCrawlTaskQueue();
  const store = new CrawlRunStore(prisma as never);
  const orchestrator = new CrawlOrchestrator(store, queue);
  const alerts = { sweep: vi.fn(async () => {}) };
  const scheduler = new CrawlScheduler(
    orchestrator,
    store,
    alerts as never,
  );
  return { prisma, queue, store, orchestrator, alerts, scheduler };
}

describe('CrawlScheduler.tick（到期投递与重启续跑）', () => {
  it('到期来源被投递且 nextCheckAt 推进一个周期；未到期不投递', async () => {
    const { prisma, queue, scheduler } = setup();
    const due = prisma.seedSource({
      id: 'src-due',
      publisher: '到期来源',
      officialUrl: 'https://a.gov.cn/',
      pollEveryMinutes: 60,
      nextCheckAt: new Date(Date.now() - 60_000), // 已到期
    });
    prisma.seedSource({
      id: 'src-future',
      publisher: '未到期来源',
      officialUrl: 'https://b.gov.cn/',
      pollEveryMinutes: 60,
      nextCheckAt: new Date(Date.now() + 3_600_000),
    });

    await scheduler.tick();

    expect(queue.count('source.discover')).toBe(1);
    expect(queue.enqueued[0]!.payload).toMatchObject({ sourceId: due.id });
    // recordCheck 已推进下次检查时间
    expect(prisma.sources[0].nextCheckAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('同一实例重复 tick：未到期不重复投递', async () => {
    const { prisma, queue, scheduler } = setup();
    prisma.seedSource({
      id: 'src-due',
      publisher: '到期来源',
      officialUrl: 'https://a.gov.cn/',
      pollEveryMinutes: 60,
      nextCheckAt: new Date(Date.now() - 60_000),
    });

    await scheduler.tick();
    expect(queue.count('source.discover')).toBe(1);

    // 第二轮：nextCheckAt 已推进到未来 → 不重复
    await scheduler.tick();
    expect(queue.count('source.discover')).toBe(1);
  });

  it('重启场景：用新的 store/orchestrator/scheduler 实例读同一份状态续跑', async () => {
    const { prisma, queue, scheduler } = setup();
    prisma.seedSource({
      id: 'src-due',
      publisher: '到期来源',
      officialUrl: 'https://a.gov.cn/',
      pollEveryMinutes: 60,
      nextCheckAt: new Date(Date.now() - 60_000),
    });

    await scheduler.tick();
    expect(queue.count('source.discover')).toBe(1);
    const advancedAt = prisma.sources[0].nextCheckAt!;

    // 模拟进程重启：全新实例（状态全部来自持久化 Source 表）
    const restarted = setup();
    restarted.prisma.sources = prisma.sources; // 同一份持久化状态
    await restarted.scheduler.tick();
    expect(restarted.queue.count('source.discover')).toBe(0);
    expect(restarted.prisma.sources[0].nextCheckAt).toEqual(advancedAt);
  });

  it('告警巡检失败不阻塞到期投递', async () => {
    const { prisma, queue, scheduler, alerts } = setup();
    alerts.sweep.mockRejectedValue(new Error('alert db down'));
    prisma.seedSource({
      id: 'src-due',
      publisher: '到期来源',
      officialUrl: 'https://a.gov.cn/',
      nextCheckAt: new Date(Date.now() - 60_000),
    });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(alerts.sweep).toHaveBeenCalled();
    expect(queue.count('source.discover')).toBe(1);
  });

  it('CRAWL_SCHEDULER_ENABLED=false 时 tick 不做任何事', async () => {
    const previous = process.env.CRAWL_SCHEDULER_ENABLED;
    process.env.CRAWL_SCHEDULER_ENABLED = 'false';
    try {
      const { prisma, queue, scheduler, alerts } = setup();
      prisma.seedSource({
        id: 'src-due',
        publisher: '到期来源',
        officialUrl: 'https://a.gov.cn/',
        nextCheckAt: new Date(Date.now() - 60_000),
      });
      await scheduler.tick();
      expect(alerts.sweep).not.toHaveBeenCalled();
      expect(queue.count('source.discover')).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.CRAWL_SCHEDULER_ENABLED;
      else process.env.CRAWL_SCHEDULER_ENABLED = previous;
    }
  });
});
