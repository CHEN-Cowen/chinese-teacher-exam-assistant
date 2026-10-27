/**
 * v7.2 工作包 4：来源健康与运行审计持久化测试。
 *
 * 覆盖：连续失败达到阈值降级、成功清零、暂停/恢复、到期来源筛选、
 * 来源登记幂等（按 officialUrl 去重）、静默 0 条判定纯函数、
 * listHealth 聚合（latestRun/parserVersion/pendingReviewCount）、
 * 进行中运行查询与历史发现判定、连续失败指标钩子。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  ALERT_TYPES,
  SourcingAlertService,
} from './sourcing-alert.service.js';
import {
  CONSECUTIVE_FAILURE_THRESHOLD,
  CrawlRunStore,
  shouldAlertZeroResults,
} from './crawl-run-store.js';
import { FakePrisma } from './testing/crawl-testing.js';

function makeStore() {
  const prisma = new FakePrisma();
  const store = new CrawlRunStore(prisma as never);
  return { prisma, store };
}

describe('shouldAlertZeroResults（静默 0 条判定）', () => {
  it('有历史发现 + 0 条 → 告警（异常零结果）', () => {
    expect(shouldAlertZeroResults(true, 0)).toBe(true);
  });

  it('无历史发现 + 0 条 → 正常（新来源冷启动）', () => {
    expect(shouldAlertZeroResults(false, 0)).toBe(false);
  });

  it('≥1 条发现 → 正常（不论是否有历史）', () => {
    expect(shouldAlertZeroResults(true, 3)).toBe(false);
    expect(shouldAlertZeroResults(false, 1)).toBe(false);
  });
});

describe('CrawlRunStore 来源健康', () => {
  it('连续失败达到阈值 → degraded；成功一次 → 复位 healthy', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: '宁波市教育局',
      officialUrl: 'https://jyj.ningbo.gov.cn/',
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const next = new Date(now.getTime() + 60_000);

    expect(CONSECUTIVE_FAILURE_THRESHOLD).toBe(3);
    for (let i = 0; i < CONSECUTIVE_FAILURE_THRESHOLD; i += 1) {
      await store.recordFailure(source.id, {
        checkedAt: now,
        nextCheckAt: next,
        reason: `boom-${i}`,
      });
    }
    expect(prisma.sources[0].consecutiveFailures).toBe(
      CONSECUTIVE_FAILURE_THRESHOLD,
    );
    expect(prisma.sources[0].healthStatus).toBe('degraded');

    await store.recordSuccess(source.id, { checkedAt: now, nextCheckAt: next });
    expect(prisma.sources[0].consecutiveFailures).toBe(0);
    expect(prisma.sources[0].healthStatus).toBe('healthy');
    expect(prisma.sources[0].lastFailReason).toBeNull();
  });

  it('结构变化与人工暂停是显式健康状态', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: '杭州市教育局',
      officialUrl: 'https://edu.hangzhou.gov.cn/',
    });

    await store.setHealth(source.id, 'structure_changed', '列表容器缺失');
    expect(prisma.sources[0].healthStatus).toBe('structure_changed');

    await store.setPaused(source.id, true);
    expect(prisma.sources[0].healthStatus).toBe('paused');
    expect(prisma.sources[0].enabled).toBe(false);

    await store.setPaused(source.id, false);
    expect(prisma.sources[0].healthStatus).toBe('healthy');
    expect(prisma.sources[0].enabled).toBe(true);
  });

  it('recordFailure 触发连续失败指标；基础设施失败（不计数）不重复上报', async () => {
    const prisma = new FakePrisma();
    const calls: Array<{ sourceId: string; count: number }> = [];
    const metrics = {
      consecutiveFailures: (fields: { sourceId: string; count: number }) => {
        calls.push(fields);
      },
    };
    const store = new CrawlRunStore(prisma as never, metrics as never);
    const source = prisma.seedSource({
      publisher: '杭州市教育局',
      officialUrl: 'https://edu.hangzhou.gov.cn/',
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const next = new Date(now.getTime() + 60_000);

    await store.recordFailure(source.id, {
      checkedAt: now,
      nextCheckAt: next,
      reason: 'boom',
    });
    expect(calls).toEqual([{ sourceId: source.id, count: 1 }]);

    await store.recordFailure(source.id, {
      checkedAt: now,
      nextCheckAt: next,
      reason: 'queue_unavailable',
      countTowardsSource: false,
    });
    expect(calls).toHaveLength(1);
  });
});

describe('CrawlRunStore.listDueSources', () => {
  it('只返回启用、非暂停且已到期的来源', async () => {
    const { prisma, store } = makeStore();
    const now = new Date('2026-10-13T02:00:00.000Z');
    const due = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
      nextCheckAt: null,
    });
    prisma.seedSource({
      publisher: 'B',
      officialUrl: 'https://b.gov.cn/',
      nextCheckAt: new Date(now.getTime() + 3_600_000),
    });
    prisma.seedSource({
      publisher: 'C',
      officialUrl: 'https://c.gov.cn/',
      healthStatus: 'paused',
      nextCheckAt: null,
    });
    prisma.seedSource({
      publisher: 'D',
      officialUrl: 'https://d.gov.cn/',
      enabled: false,
      nextCheckAt: null,
    });
    prisma.seedSource({
      publisher: 'E',
      officialUrl: 'https://e.gov.cn/',
      healthStatus: 'blocked',
      nextCheckAt: null,
    });

    const rows = await store.listDueSources(now);
    expect(rows.map((r) => r.id)).toEqual([due.id]);
  });
});

describe('CrawlRunStore.upsertSource', () => {
  it('按 officialUrl 幂等：重复登记不产生重复来源', async () => {
    const { prisma, store } = makeStore();

    const first = await store.upsertSource({
      publisher: '宁波市教育局',
      officialUrl: 'https://jyj.ningbo.gov.cn/',
      adapterKey: 'ningbo-education',
      listUrls: [],
      allowedHosts: ['jyj.ningbo.gov.cn'],
    });
    const second = await store.upsertSource({
      publisher: '宁波市教育局',
      officialUrl: 'https://jyj.ningbo.gov.cn/',
      adapterKey: 'ningbo-education',
      listUrls: ['https://jyj.ningbo.gov.cn/col/col1/index.html'],
      allowedHosts: ['jyj.ningbo.gov.cn'],
      pollEveryMinutes: 30,
    });

    expect(prisma.sources).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.pollEveryMinutes).toBe(30);
    expect(second.listUrls).toEqual([
      'https://jyj.ningbo.gov.cn/col/col1/index.html',
    ]);
  });
});

describe('CrawlRunStore.findActiveRun / hasHistoryDiscovery', () => {
  it('只命中窗口内 queued/running 的运行；已结束或超窗不算', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const now = new Date('2026-10-13T03:00:00.000Z');
    const since = new Date(now.getTime() - 15 * 60_000);

    expect(await store.findActiveRun(source.id, since)).toBeNull();

    const finished = await prisma.crawlRun.create({
      data: { sourceId: source.id, trigger: 'admin', status: 'succeeded' },
    });
    prisma.runs.find((r) => r.id === finished.id)!.startedAt = now;
    expect(await store.findActiveRun(source.id, since)).toBeNull();

    const stale = await prisma.crawlRun.create({
      data: { sourceId: source.id, trigger: 'admin', status: 'running' },
    });
    prisma.runs.find((r) => r.id === stale.id)!.startedAt = new Date(
      since.getTime() - 60_000,
    );
    expect(await store.findActiveRun(source.id, since)).toBeNull();

    const active = await prisma.crawlRun.create({
      data: { sourceId: source.id, trigger: 'admin', status: 'queued' },
    });
    prisma.runs.find((r) => r.id === active.id)!.startedAt = now;
    expect((await store.findActiveRun(source.id, since))!.id).toBe(active.id);
  });

  it('历史发现判定：有逻辑文档或历史运行发现过 ≥1 条即视为有历史', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });

    expect(await store.hasHistoryDiscovery(source.id)).toBe(false);

    // 历史运行 discoveredCount>0 → 有历史
    await prisma.crawlRun.create({
      data: {
        sourceId: source.id,
        trigger: 'schedule',
        status: 'succeeded',
        discoveredCount: 2,
      },
    });
    expect(await store.hasHistoryDiscovery(source.id)).toBe(true);

    // 全新来源只有逻辑文档也算有历史
    const fresh = prisma.seedSource({
      publisher: 'B',
      officialUrl: 'https://b.gov.cn/',
    });
    prisma.seedDocument({
      sourceId: fresh.id,
      canonicalUrl: 'https://b.gov.cn/x.html',
    });
    expect(await store.hasHistoryDiscovery(fresh.id)).toBe(true);
  });
});

describe('CrawlRunStore 失败退避（M02/F3）', () => {
  it('计入来源的失败按「周期 × 2^(连续失败-1)，封顶 8 倍」推迟下次检查', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
      pollEveryMinutes: 60,
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const multipliers = [1, 2, 4, 8, 8]; // 1/2/3/4/5 次连续失败
    for (let i = 0; i < multipliers.length; i += 1) {
      await store.recordFailure(source.id, {
        checkedAt: now,
        reason: `boom-${i}`,
      });
      const expected = new Date(now.getTime() + multipliers[i]! * 60 * 60_000);
      expect(prisma.sources[0].nextCheckAt).toEqual(expected);
    }
  });

  it('显式 nextCheckAt 优先于退避计算', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
      pollEveryMinutes: 60,
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const explicit = new Date(now.getTime() + 5 * 60_000);
    await store.recordFailure(source.id, {
      checkedAt: now,
      nextCheckAt: explicit,
      reason: 'boom',
    });
    expect(prisma.sources[0].nextCheckAt).toEqual(explicit);
  });

  it('不计入来源的失败（countTowardsSource=false）沿用常规周期，不退避不累计', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
      pollEveryMinutes: 60,
      consecutiveFailures: 2, // 已有 2 次历史失败
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    await store.recordFailure(source.id, {
      checkedAt: now,
      reason: 'queue_unavailable',
      countTowardsSource: false,
    });
    // 常规周期 1x，而不是按历史 2 次失败的 4x 退避
    expect(prisma.sources[0].nextCheckAt).toEqual(
      new Date(now.getTime() + 60 * 60_000),
    );
    expect(prisma.sources[0].consecutiveFailures).toBe(2);
  });
});

describe('CrawlRunStore 持久化告警钩子（M02/F3）', () => {
  function makeStoreWithAlerts() {
    const prisma = new FakePrisma();
    const alerts = {
      raise: vi.fn(async () => {}),
      resolveForSource: vi.fn(async () => {}),
    };
    const store = new CrawlRunStore(
      prisma as never,
      undefined,
      alerts as unknown as SourcingAlertService,
    );
    return { prisma, store, alerts };
  }

  it('连续失败达到阈值 → raise consecutive_failures critical；成功 → resolveForSource', async () => {
    const { prisma, store, alerts } = makeStoreWithAlerts();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const next = new Date(now.getTime() + 60_000);

    for (let i = 0; i < CONSECUTIVE_FAILURE_THRESHOLD; i += 1) {
      await store.recordFailure(source.id, {
        checkedAt: now,
        nextCheckAt: next,
        reason: `boom-${i}`,
      });
    }
    expect(alerts.raise).toHaveBeenCalledTimes(1);
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ALERT_TYPES.consecutiveFailures,
        sourceId: source.id,
        severity: 'critical',
      }),
    );

    await store.recordSuccess(source.id, { checkedAt: now, nextCheckAt: next });
    expect(alerts.resolveForSource).toHaveBeenCalledWith(source.id, now);
  });

  it('未达阈值不告警；基础设施失败（不计数）不告警', async () => {
    const { prisma, store, alerts } = makeStoreWithAlerts();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const next = new Date(now.getTime() + 60_000);

    await store.recordFailure(source.id, {
      checkedAt: now,
      nextCheckAt: next,
      reason: 'boom',
    });
    expect(alerts.raise).not.toHaveBeenCalled();

    await store.recordFailure(source.id, {
      checkedAt: now,
      nextCheckAt: next,
      reason: 'queue_unavailable',
      countTowardsSource: false,
    });
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('setHealth structure_changed / blocked → 对应类型告警；degraded 不在此告警', async () => {
    const { prisma, store, alerts } = makeStoreWithAlerts();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });

    await store.setHealth(source.id, 'structure_changed', '列表容器缺失');
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ALERT_TYPES.structureChanged,
        sourceId: source.id,
        severity: 'critical',
      }),
    );

    await store.setHealth(source.id, 'blocked', 'captcha');
    expect(alerts.raise).toHaveBeenCalledWith(
      expect.objectContaining({ type: ALERT_TYPES.blocked, sourceId: source.id }),
    );

    alerts.raise.mockClear();
    await store.setHealth(source.id, 'degraded', '连续失败');
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('告警出口抛错不影响健康记录主流程', async () => {
    const prisma = new FakePrisma();
    const alerts = {
      raise: vi.fn(async () => {
        throw new Error('alert store down');
      }),
      resolveForSource: vi.fn(async () => {
        throw new Error('alert store down');
      }),
    };
    const store = new CrawlRunStore(
      prisma as never,
      undefined,
      alerts as unknown as SourcingAlertService,
    );
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const now = new Date('2026-10-13T01:00:00.000Z');
    const next = new Date(now.getTime() + 60_000);

    await store.recordFailure(source.id, {
      checkedAt: now,
      nextCheckAt: next,
      reason: 'boom',
    });
    expect(prisma.sources[0].consecutiveFailures).toBe(1);

    await store.recordSuccess(source.id, { checkedAt: now, nextCheckAt: next });
    expect(prisma.sources[0].healthStatus).toBe('healthy');
  });
});

describe('CrawlRunStore.listHealth 聚合', () => {
  it('无运行/无解析/无待审核时聚合字段为 null 与 0', async () => {
    const { prisma, store } = makeStore();
    prisma.seedSource({
      id: 'src-1',
      publisher: '杭州市教育局',
      officialUrl: 'https://edu.hangzhou.gov.cn/',
    });

    const [summary] = await store.listHealth();

    expect(summary.id).toBe('src-1');
    expect(summary.officialUrl).toBe('https://edu.hangzhou.gov.cn/');
    expect(summary.healthStatus).toBe('healthy');
    expect(summary.latestRun).toBeNull();
    expect(summary.parserVersion).toBeNull();
    expect(summary.pendingReviewCount).toBe(0);
  });

  it('聚合 latestRun（按 startedAt 最新）、parserVersion（最新解析运行）与 pendingReviewCount', async () => {
    const { prisma, store } = makeStore();
    prisma.seedSource({
      id: 'src-1',
      publisher: '杭州市教育局',
      officialUrl: 'https://edu.hangzhou.gov.cn/',
    });
    // 另一条来源及其快照（不应串台）
    prisma.seedSource({
      id: 'src-2',
      publisher: '宁波市教育局',
      officialUrl: 'https://jyj.ningbo.gov.cn/',
    });
    const otherSnapshot = prisma.seedSnapshot({
      sourceId: 'src-2',
      contentHash: 'h-other',
    });

    const older = await prisma.crawlRun.create({
      data: {
        sourceId: 'src-1',
        trigger: 'schedule',
        status: 'succeeded',
        discoveredCount: 3,
      },
    });
    prisma.runs.find((r) => r.id === older.id)!.startedAt = new Date(
      '2026-10-12T01:00:00.000Z',
    );
    const newer = await prisma.crawlRun.create({
      data: {
        sourceId: 'src-1',
        trigger: 'admin',
        status: 'failed',
        errorSummary: 'boom',
        failedCount: 1,
        adapterVersion: 'hangzhou-education@wp4-v1',
      },
    });
    prisma.runs.find((r) => r.id === newer.id)!.startedAt = new Date(
      '2026-10-13T01:00:00.000Z',
    );

    const snapshot = prisma.seedSnapshot({
      sourceId: 'src-1',
      contentHash: 'h-1',
    });
    await prisma.documentParseRun.create({
      data: {
        snapshotId: snapshot.id,
        parserVersion: 'pv-old',
        format: 'html',
        status: 'parsed',
        createdAt: new Date('2026-10-12T02:00:00.000Z'),
      },
    });
    await prisma.documentParseRun.create({
      data: {
        snapshotId: snapshot.id,
        parserVersion: 'pv-new',
        format: 'pdf',
        status: 'parsed',
        createdAt: new Date('2026-10-13T02:00:00.000Z'),
      },
    });
    // 其他来源的解析运行不应计入 src-1
    await prisma.documentParseRun.create({
      data: {
        snapshotId: otherSnapshot.id,
        parserVersion: 'pv-other',
        format: 'html',
        status: 'parsed',
        createdAt: new Date('2026-10-13T03:00:00.000Z'),
      },
    });

    await prisma.extractionRun.create({
      data: {
        snapshotId: snapshot.id,
        parserVersion: 'ev1',
        idempotencyKey: 'k1',
        status: 'pending_review',
      },
    });
    await prisma.extractionRun.create({
      data: {
        snapshotId: snapshot.id,
        parserVersion: 'ev1',
        idempotencyKey: 'k2',
        status: 'approved',
      },
    });
    // 其他来源的待审核不应计入 src-1
    await prisma.extractionRun.create({
      data: {
        snapshotId: otherSnapshot.id,
        parserVersion: 'ev1',
        idempotencyKey: 'k3',
        status: 'pending_review',
      },
    });

    const summaries = await store.listHealth();
    const summary = summaries.find((s) => s.id === 'src-1')!;
    const other = summaries.find((s) => s.id === 'src-2')!;

    expect(summary.latestRun!.id).toBe(newer.id);
    expect(summary.latestRun!.status).toBe('failed');
    expect(summary.latestRun!.trigger).toBe('admin');
    expect(summary.latestRun!.failedCount).toBe(1);
    expect(summary.latestRun!.errorSummary).toBe('boom');
    expect(summary.parserVersion).toBe('pv-new');
    expect(summary.pendingReviewCount).toBe(1);

    expect(other.parserVersion).toBe('pv-other');
    expect(other.pendingReviewCount).toBe(1);
  });
});

describe('CrawlRunStore URL JSON 账本', () => {
  it('发现完成前后写入 URL 结果时，异步计数不会互相覆盖', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const before = await store.createRun({
      sourceId: source.id,
      trigger: 'admin',
    });
    await Promise.all([
      store.completeDiscovery(before.id, {
        status: 'succeeded',
        discoveredCount: 2,
      }),
      store.recordFetchOutcome(
        before.id,
        'https://a.gov.cn/one.pdf',
        'downloaded',
      ),
    ]);
    expect(prisma.findRun(before.id)).toMatchObject({
      status: 'succeeded',
      discoveredCount: 2,
      downloadedCount: 1,
    });

    const after = await store.createRun({
      sourceId: source.id,
      trigger: 'admin',
    });
    await Promise.all([
      store.recordFetchOutcome(
        after.id,
        'https://a.gov.cn/two.pdf',
        'unchanged',
      ),
      store.completeDiscovery(after.id, {
        status: 'succeeded',
        discoveredCount: 3,
      }),
    ]);
    expect(prisma.findRun(after.id)).toMatchObject({
      status: 'succeeded',
      discoveredCount: 3,
      unchangedCount: 1,
    });
  });

  it('重复写入 downloaded 后 unchanged，仍只保留一次下载', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const run = await store.createRun({
      sourceId: source.id,
      trigger: 'admin',
    });
    await store.recordFetchOutcome(
      run.id,
      'https://a.gov.cn/file.pdf',
      'downloaded',
    );
    await store.recordFetchOutcome(
      run.id,
      'https://a.gov.cn/file.pdf',
      'unchanged',
    );
    await store.completeDiscovery(run.id, { status: 'succeeded' });
    expect(prisma.findRun(run.id)).toMatchObject({
      downloadedCount: 1,
      unchangedCount: 0,
    });
  });

  it('同 URL 失败后重试成功会恢复为成功计数', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const run = await store.createRun({
      sourceId: source.id,
      trigger: 'admin',
    });
    await store.recordFetchOutcome(
      run.id,
      'https://a.gov.cn/file.pdf',
      'failed',
      'timeout',
    );
    await store.recordFetchOutcome(
      run.id,
      'https://a.gov.cn/file.pdf',
      'downloaded',
    );
    await store.completeDiscovery(run.id, { status: 'succeeded' });
    expect(prisma.findRun(run.id)).toMatchObject({
      status: 'succeeded',
      downloadedCount: 1,
      failedCount: 0,
    });
  });

  it('发现完成后仍有 queued 附件时，运行保持 running', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const run = await store.createRun({
      sourceId: source.id,
      trigger: 'admin',
    });
    await store.completeDiscovery(run.id, { status: 'succeeded' });
    await store.recordFetchOutcome(
      run.id,
      'https://a.gov.cn/file.pdf',
      'queued',
    );
    expect(prisma.findRun(run.id)).toMatchObject({
      status: 'running',
      finishedAt: null,
    });
  });

  it('blocked URL 不会把运行判为成功', async () => {
    const { prisma, store } = makeStore();
    const source = prisma.seedSource({
      publisher: 'A',
      officialUrl: 'https://a.gov.cn/',
    });
    const run = await store.createRun({
      sourceId: source.id,
      trigger: 'admin',
    });
    await store.recordFetchOutcome(
      run.id,
      'https://a.gov.cn/file.pdf',
      'blocked',
      'captcha',
    );
    await store.completeDiscovery(run.id, { status: 'succeeded' });
    expect(prisma.findRun(run.id)).toMatchObject({
      status: 'blocked',
      failedCount: 1,
    });
  });
});
