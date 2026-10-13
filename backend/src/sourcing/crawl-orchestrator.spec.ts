/**
 * v7.2 工作包 4：CrawlOrchestrator 契约测试。
 *
 * 覆盖：三种触发方式、按窗口幂等、非法触发、来源不存在、来源暂停、
 * Redis 暂时不可用（降级不崩溃、不计入来源连续失败、恢复后可重试）。
 */
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlRunStore } from './crawl-run-store.js';
import { QueueUnavailableError } from './jobs/task-queue.js';
import { FakeCrawlTaskQueue, FakePrisma } from './testing/crawl-testing.js';

const HZ = {
  publisher: '杭州市教育局',
  officialUrl: 'https://edu.hangzhou.gov.cn/',
  adapterKey: 'hangzhou-education',
};

function setup(sourceOverrides: Record<string, unknown> = {}) {
  const prisma = new FakePrisma();
  const source = prisma.seedSource({ id: 'src-hz', ...HZ, ...sourceOverrides });
  const queue = new FakeCrawlTaskQueue();
  const store = new CrawlRunStore(prisma as never);
  const orchestrator = new CrawlOrchestrator(store, queue);
  return { prisma, source, queue, store, orchestrator };
}

const NOW = new Date('2026-10-13T00:10:00.000Z');

describe('CrawlOrchestrator.checkSource', () => {
  it('schedule：创建 queued 运行、投递 source.discover、推进来源检查时间', async () => {
    const { prisma, queue, orchestrator } = setup();

    const ref = await orchestrator.checkSource('src-hz', 'schedule', { now: NOW });

    expect(ref.status).toBe('queued');
    expect(ref.deduplicated).toBe(false);
    expect(ref.jobId).toMatch(/^discover:src-hz:/);
    expect(queue.count('source.discover')).toBe(1);

    const run = prisma.findRun(ref.runId)!;
    expect(run.trigger).toBe('schedule');
    expect(run.status).toBe('queued');
    expect(String(run.adapterVersion)).toBe('hangzhou-education@wp4-v1');

    const source = prisma.sources[0];
    expect(source.lastCheckedAt).toEqual(NOW);
    expect(source.nextCheckAt).toEqual(new Date(NOW.getTime() + 60 * 60_000));
  });

  it('admin 与 retry 是合法触发，且各自生成独立任务（nonce 不同不互相吞并）', async () => {
    const { queue, orchestrator } = setup();

    const admin = await orchestrator.checkSource('src-hz', 'admin', { nonce: 'admin-1' });
    const retry = await orchestrator.checkSource('src-hz', 'retry', { nonce: 'retry-1' });

    expect(admin.jobId).not.toBe(retry.jobId);
    expect(queue.count('source.discover')).toBe(2);
    expect(admin.status).toBe('queued');
    expect(retry.status).toBe('queued');
  });

  it('同一 schedule 窗口重复触发被幂等吸收，不新建任务', async () => {
    const { queue, orchestrator } = setup();

    const first = await orchestrator.checkSource('src-hz', 'schedule', { now: NOW });
    const second = await orchestrator.checkSource('src-hz', 'schedule', { now: NOW });

    expect(second.deduplicated).toBe(true);
    expect(second.jobId).toBe(first.jobId);
    expect(queue.count('source.discover')).toBe(1);
  });

  it('非法触发方式被拒绝（只接受 schedule / admin / retry）', async () => {
    const { orchestrator } = setup();
    await expect(
      orchestrator.checkSource('src-hz', 'manual' as never),
    ).rejects.toThrow(/不支持的触发方式/);
  });

  it('来源不存在 → NotFound（不静默跳过）', async () => {
    const { orchestrator } = setup();
    await expect(
      orchestrator.checkSource('missing', 'admin'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('来源暂停：不投递任何任务，运行记为 skipped_paused', async () => {
    const { prisma, queue, orchestrator } = setup({ healthStatus: 'paused' });

    const ref = await orchestrator.checkSource('src-hz', 'schedule', { now: NOW });

    expect(ref.status).toBe('skipped_paused');
    expect(ref.jobId).toBeNull();
    expect(queue.enqueued).toHaveLength(0);
    expect(prisma.findRun(ref.runId)!.status).toBe('skipped_paused');
  });

  it('来源被停用（enabled=false）同样跳过', async () => {
    const { queue, orchestrator } = setup({ enabled: false });
    const ref = await orchestrator.checkSource('src-hz', 'admin', { nonce: 'x' });
    expect(ref.status).toBe('skipped_paused');
    expect(queue.enqueued).toHaveLength(0);
  });

  it('来源封禁待人工处理（blocked）：跳过自动抓取，运行记 skipped_blocked', async () => {
    const { prisma, queue, orchestrator } = setup({ healthStatus: 'blocked' });

    const ref = await orchestrator.checkSource('src-hz', 'schedule', { now: NOW });

    expect(ref.status).toBe('skipped_blocked');
    expect(ref.jobId).toBeNull();
    expect(queue.enqueued).toHaveLength(0);
    expect(prisma.findRun(ref.runId)!.status).toBe('skipped_blocked');
  });

  it('Redis 暂时不可用：抛 QueueUnavailableError，运行记 failed 但不计入来源连续失败；恢复后可重试', async () => {
    const { prisma, queue, orchestrator } = setup();
    queue.available = false;

    await expect(
      orchestrator.checkSource('src-hz', 'schedule', { now: NOW }),
    ).rejects.toBeInstanceOf(QueueUnavailableError);

    const failedRun = prisma.runs.at(-1)!;
    expect(failedRun.status).toBe('failed');
    expect(failedRun.errorSummary).toBe('queue_unavailable');
    // 基础设施不可用不应污染来源健康（否则会平白降级来源）
    expect(prisma.sources[0].consecutiveFailures).toBe(0);
    expect(prisma.sources[0].healthStatus).toBe('healthy');

    // Redis 恢复后同一来源可正常重试
    queue.available = true;
    const ref = await orchestrator.checkSource('src-hz', 'retry', { nonce: 'after-recovery' });
    expect(ref.status).toBe('queued');
    expect(queue.count('source.discover')).toBe(1);
  });
});
