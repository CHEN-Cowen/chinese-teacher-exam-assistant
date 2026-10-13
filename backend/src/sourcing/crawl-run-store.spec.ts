/**
 * v7.2 工作包 4：来源健康与运行审计持久化测试。
 *
 * 覆盖：连续失败达到阈值降级、成功清零、暂停/恢复、到期来源筛选、
 * 来源登记幂等（按 officialUrl 去重）。
 */
import { describe, expect, it } from 'vitest';
import { CONSECUTIVE_FAILURE_THRESHOLD, CrawlRunStore } from './crawl-run-store.js';
import { FakePrisma } from './testing/crawl-testing.js';

function makeStore() {
  const prisma = new FakePrisma();
  const store = new CrawlRunStore(prisma as never);
  return { prisma, store };
}

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
    expect(prisma.sources[0].consecutiveFailures).toBe(CONSECUTIVE_FAILURE_THRESHOLD);
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
    expect(second.listUrls).toEqual(['https://jyj.ningbo.gov.cn/col/col1/index.html']);
  });
});
