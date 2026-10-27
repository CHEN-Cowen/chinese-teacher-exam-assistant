/**
 * M02/F3：持久化运行告警测试。
 *
 * 覆盖：raise 幂等累加（同 (type, sourceId) 一行）、解除（按来源/按类型）、
 * sweep 超期来源（source_overdue）与 Worker 心跳（worker_down）的产生与
 * 自动解除、巡检异常不外抛。
 */
import { describe, expect, it } from 'vitest';
import {
  ALERT_TYPES,
  OVERDUE_PERIOD_MULTIPLIER,
  SourcingAlertService,
} from './sourcing-alert.service.js';
import type { CrawlHealthService, WorkerStatus } from './crawl-health.service.js';

interface AlertRow extends Record<string, unknown> {
  id: string;
  type: string;
  scope: string;
  sourceId: string | null;
  severity: string;
  message: string;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
}

interface SourceRow extends Record<string, unknown> {
  id: string;
  publisher: string;
  enabled: boolean;
  healthStatus: string;
  pollEveryMinutes: number;
  nextCheckAt: Date | null;
  lastCheckedAt: Date | null;
}

function applyUpdate(
  target: Record<string, unknown>,
  data: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(data)) {
    if (
      value &&
      typeof value === 'object' &&
      'increment' in (value as Record<string, unknown>)
    ) {
      target[key] =
        Number(target[key] ?? 0) +
        Number((value as { increment: number }).increment);
    } else {
      target[key] = value;
    }
  }
}

/** 只实现 SourcingAlertService 用到的最小 Prisma 接口 */
class FakeAlertPrisma {
  alerts: AlertRow[] = [];
  sources: SourceRow[] = [];
  private seq = 0;

  seedSource(partial: Partial<SourceRow> & { id: string; publisher: string }): SourceRow {
    const row: SourceRow = {
      enabled: true,
      healthStatus: 'healthy',
      pollEveryMinutes: 60,
      nextCheckAt: null,
      lastCheckedAt: null,
      ...partial,
    };
    this.sources.push(row);
    return row;
  }

  seedAlert(partial: Partial<AlertRow> & { id: string; type: string }): AlertRow {
    const now = new Date('2026-10-13T00:00:00.000Z');
    const row: AlertRow = {
      scope: partial.sourceId ? 'source' : 'global',
      sourceId: null,
      severity: 'warning',
      message: 'seeded',
      occurrences: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      resolvedAt: null,
      ...partial,
    };
    this.alerts.push(row);
    return row;
  }

  readonly sourcingAlert = {
    findFirst: async ({
      where,
    }: {
      where: { type: string; sourceId: string | null };
    }) =>
      this.alerts.find(
        (a) => a.type === where.type && (a.sourceId ?? null) === (where.sourceId ?? null),
      ) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = {
        id: `alert-${(this.seq += 1)}`,
        resolvedAt: null,
        ...data,
      } as unknown as AlertRow;
      this.alerts.push(row);
      return row;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        sourceId?: string;
        type?: string;
        resolvedAt: null;
      };
      data: Record<string, unknown>;
    }) => {
      let count = 0;
      for (const row of this.alerts) {
        if (where.sourceId !== undefined && row.sourceId !== where.sourceId) continue;
        if (where.type !== undefined && row.type !== where.type) continue;
        if (where.resolvedAt === null && row.resolvedAt !== null) continue;
        applyUpdate(row, data);
        count += 1;
      }
      return { count };
    },
    findMany: async ({
      where,
    }: {
      where: { resolvedAt: null; type?: string };
    }) => {
      return this.alerts.filter(
        (row) =>
          row.resolvedAt === null &&
          (where.type === undefined || row.type === where.type),
      );
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = this.alerts.find((a) => a.id === where.id);
      if (!row) throw new Error(`alert not found: ${where.id}`);
      applyUpdate(row, data);
      return row;
    },
  };

  readonly source = {
    findMany: async ({
      where,
    }: {
      where?: { enabled?: boolean; healthStatus?: { notIn?: string[] } };
    }) => {
      let rows = [...this.sources];
      if (where?.enabled !== undefined) {
        rows = rows.filter((s) => s.enabled === where.enabled);
      }
      if (where?.healthStatus?.notIn) {
        const excluded = where.healthStatus.notIn;
        rows = rows.filter((s) => !excluded.includes(s.healthStatus));
      }
      return rows;
    },
  };
}

function makeService(
  prisma = new FakeAlertPrisma(),
  health?: CrawlHealthService,
) {
  return {
    prisma,
    alerts: new SourcingAlertService(prisma as never, health),
  };
}

function healthReturning(status: WorkerStatus): CrawlHealthService {
  return {
    workerStatus: async () => status,
  } as unknown as CrawlHealthService;
}

describe('SourcingAlertService.raise（幂等累加）', () => {
  it('首次创建 occurrences=1；重复发生累加并刷新 lastSeenAt、清除 resolvedAt', async () => {
    const { prisma, alerts } = makeService();
    const t1 = new Date('2026-10-13T01:00:00.000Z');
    const t2 = new Date('2026-10-13T02:00:00.000Z');

    await alerts.raise({
      type: ALERT_TYPES.consecutiveFailures,
      sourceId: 'src-1',
      severity: 'critical',
      message: '连续失败 3 次',
      now: t1,
    });
    expect(prisma.alerts).toHaveLength(1);
    expect(prisma.alerts[0]).toMatchObject({
      type: 'consecutive_failures',
      sourceId: 'src-1',
      scope: 'source',
      severity: 'critical',
      occurrences: 1,
      resolvedAt: null,
    });

    await alerts.raise({
      type: ALERT_TYPES.consecutiveFailures,
      sourceId: 'src-1',
      message: '连续失败 4 次',
      now: t2,
    });
    expect(prisma.alerts).toHaveLength(1);
    expect(prisma.alerts[0]).toMatchObject({
      occurrences: 2,
      lastSeenAt: t2,
      message: '连续失败 4 次',
    });
  });

  it('已解除的告警再次发生 → 复活（resolvedAt 清空），不新增行', async () => {
    const { prisma, alerts } = makeService();
    const t1 = new Date('2026-10-13T01:00:00.000Z');
    await alerts.raise({
      type: ALERT_TYPES.structureChanged,
      sourceId: 'src-1',
      message: '结构变化',
      now: t1,
    });
    await alerts.resolveForSource('src-1', t1);
    expect(prisma.alerts[0].resolvedAt).toEqual(t1);

    const t2 = new Date('2026-10-13T03:00:00.000Z');
    await alerts.raise({
      type: ALERT_TYPES.structureChanged,
      sourceId: 'src-1',
      message: '结构变化（再次）',
      now: t2,
    });
    expect(prisma.alerts).toHaveLength(1);
    expect(prisma.alerts[0].resolvedAt).toBeNull();
    expect(prisma.alerts[0].occurrences).toBe(2);
  });

  it('全局告警（sourceId=null）与来源告警互不串台', async () => {
    const { prisma, alerts } = makeService();
    await alerts.raise({
      type: ALERT_TYPES.workerDown,
      message: 'worker down',
      now: new Date(),
    });
    expect(prisma.alerts[0]).toMatchObject({ scope: 'global', sourceId: null });

    // 全局告警重复发生同样幂等累加（复合唯一含可空列，worker_down 无来源）
    await alerts.raise({
      type: ALERT_TYPES.workerDown,
      message: 'worker still down',
      now: new Date(),
    });
    expect(prisma.alerts).toHaveLength(1);
    expect(prisma.alerts[0].occurrences).toBe(2);
  });

  it('并发创建撞唯一索引（P2002）→ 回落为 update 累加', async () => {
    const base = new FakeAlertPrisma();
    let findFirstCalls = 0;
    let createCalls = 0;
    const flaky = {
      sourcingAlert: {
        findFirst: async () => {
          findFirstCalls += 1;
          // 第一次查询（create 之前）并发行尚未可见；P2002 后能看到
          return findFirstCalls >= 2 ? (base.alerts[0] ?? null) : null;
        },
        create: async (input: { data: Record<string, unknown> }) => {
          createCalls += 1;
          if (createCalls === 1) {
            // 模拟并发对手抢先插入，本请求撞唯一索引
            base.alerts.push({
              ...input.data,
              id: 'alert-concurrent',
              resolvedAt: null,
            } as unknown as AlertRow);
            throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
          }
          return base.sourcingAlert.create(input);
        },
        update: base.sourcingAlert.update,
      },
    };
    const alerts = new SourcingAlertService(flaky as never);
    await alerts.raise({
      type: ALERT_TYPES.consecutiveFailures,
      sourceId: 'src-1',
      message: '并发回落',
      now: new Date('2026-10-13T01:00:00.000Z'),
    });
    expect(base.alerts).toHaveLength(1);
    expect(base.alerts[0]).toMatchObject({ type: 'consecutive_failures', occurrences: 2 });
  });
});

describe('SourcingAlertService.resolve / listActive', () => {
  it('resolveForSource 只解除该来源；resolveByType 解除该类型全部', async () => {
    const { alerts } = makeService();
    const now = new Date('2026-10-13T01:00:00.000Z');
    await alerts.raise({ type: ALERT_TYPES.consecutiveFailures, sourceId: 'src-1', message: 'a', now });
    await alerts.raise({ type: ALERT_TYPES.sourceOverdue, sourceId: 'src-1', message: 'b', now });
    await alerts.raise({ type: ALERT_TYPES.sourceOverdue, sourceId: 'src-2', message: 'c', now });
    await alerts.raise({ type: ALERT_TYPES.workerDown, message: 'd', now });

    await alerts.resolveForSource('src-1', now);
    expect(
      (await alerts.listActive()).map((a) => `${a.type}:${a.sourceId}`),
    ).toEqual(['source_overdue:src-2', 'worker_down:null']);

    await alerts.resolveByType(ALERT_TYPES.workerDown, now);
    expect((await alerts.listActive()).map((a) => a.sourceId)).toEqual(['src-2']);
  });

  it('解除写 resolvedAt 保留历史，不删除行', async () => {
    const { prisma, alerts } = makeService();
    const now = new Date('2026-10-13T01:00:00.000Z');
    await alerts.raise({ type: ALERT_TYPES.blocked, sourceId: 'src-1', message: 'x', now });
    await alerts.resolveForSource('src-1', now);
    expect(prisma.alerts).toHaveLength(1);
    expect(prisma.alerts[0].resolvedAt).toEqual(now);
  });
});

describe('SourcingAlertService.sweep（来源超期）', () => {
  it('启用来源超过 2 个周期未检查 → source_overdue critical；恢复后自动解除', async () => {
    const { prisma, alerts } = makeService();
    const now = new Date('2026-10-13T12:00:00.000Z');
    const overdueAt = new Date(now.getTime() - 3 * 3600_000); // 周期 60min，3h 前检查 > 2 周期
    const freshAt = new Date(now.getTime() - 30 * 60_000);
    const overdue = prisma.seedSource({
      id: 'src-overdue',
      publisher: '超期来源',
      lastCheckedAt: overdueAt,
    });
    prisma.seedSource({
      id: 'src-fresh',
      publisher: '正常来源',
      lastCheckedAt: freshAt,
    });
    prisma.seedSource({
      id: 'src-paused',
      publisher: '暂停来源',
      healthStatus: 'paused',
      lastCheckedAt: overdueAt,
    });

    await alerts.sweep(now);
    const active = await alerts.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      type: 'source_overdue',
      sourceId: overdue.id,
      severity: 'critical',
    });

    // 恢复：检查推进后下一轮 sweep 自动解除
    prisma.sources[0].lastCheckedAt = new Date(now.getTime() - 60_000);
    await alerts.sweep(now);
    expect(await alerts.listActive()).toEqual([]);
    expect(prisma.alerts[0].resolvedAt).toEqual(now);
  });

  it(`超期阈值 = 周期 × ${OVERDUE_PERIOD_MULTIPLIER}：恰好 2 个周期内不告警`, async () => {
    const { prisma, alerts } = makeService();
    const now = new Date('2026-10-13T12:00:00.000Z');
    // 60min 周期 × 2 = 120min 阈值；100min 前检查未超
    prisma.seedSource({
      id: 'src-1',
      publisher: 'A',
      pollEveryMinutes: 60,
      lastCheckedAt: new Date(now.getTime() - 100 * 60_000),
    });
    await alerts.sweep(now);
    expect(await alerts.listActive()).toEqual([]);
  });

  it('nextCheckAt 优先于 lastCheckedAt 作为到期基准', async () => {
    const { prisma, alerts } = makeService();
    const now = new Date('2026-10-13T12:00:00.000Z');
    prisma.seedSource({
      id: 'src-1',
      publisher: 'A',
      pollEveryMinutes: 60,
      // 计划时间已在 3 小时前，但 lastCheckedAt 很新（如调度推迟）
      lastCheckedAt: new Date(now.getTime() - 60_000),
      nextCheckAt: new Date(now.getTime() - 3 * 3600_000),
    });
    await alerts.sweep(now);
    expect((await alerts.listActive()).map((a) => a.type)).toEqual([
      'source_overdue',
    ]);
  });
});

describe('SourcingAlertService.sweep（Worker 心跳）', () => {
  it('心跳过期 → worker_down critical；心跳恢复 → 自动解除', async () => {
    const { alerts } = makeService(
      new FakeAlertPrisma(),
      healthReturning({
        status: 'down',
        lastSeenAt: '2026-10-13T11:00:00.000Z',
        ageMs: 600_000,
      }),
    );
    const now = new Date('2026-10-13T12:00:00.000Z');
    await alerts.sweep(now);
    const active = await alerts.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      type: 'worker_down',
      scope: 'global',
      severity: 'critical',
    });
    expect(active[0].message).toContain('2026-10-13T11:00:00.000Z');

    // 心跳恢复 → 解除
    const recovered = makeService(
      new FakeAlertPrisma(),
      healthReturning({ status: 'up', lastSeenAt: '2026-10-13T11:59:00.000Z', ageMs: 60_000 }),
    );
    await recovered.alerts.raise({
      type: ALERT_TYPES.workerDown,
      message: '残留告警',
      now,
    });
    await recovered.alerts.sweep(now);
    expect(await recovered.alerts.listActive()).toEqual([]);
  });

  it('无心跳记录 → worker_down（无 lastSeenAt 文案）', async () => {
    const { alerts } = makeService(
      new FakeAlertPrisma(),
      healthReturning({ status: 'down', lastSeenAt: null, ageMs: null }),
    );
    await alerts.sweep(new Date('2026-10-13T12:00:00.000Z'));
    const active = await alerts.listActive();
    expect(active[0].message).toContain('无心跳记录');
  });

  it('未注入 CrawlHealthService 时不产生 worker_down（仅来源巡检）', async () => {
    const { prisma, alerts } = makeService();
    await alerts.sweep(new Date());
    expect(prisma.alerts).toEqual([]);
  });
});

describe('SourcingAlertService.sweep（异常隔离）', () => {
  it('巡检内部异常不外抛（不影响调度 tick 主流程）', async () => {
    const prisma = new FakeAlertPrisma();
    const failing = new SourcingAlertService({
      source: {
        findMany: async () => {
          throw new Error('db down');
        },
      },
    } as never);
    await expect(failing.sweep(new Date())).resolves.toBeUndefined();
    expect(prisma.alerts).toEqual([]);
  });
});
