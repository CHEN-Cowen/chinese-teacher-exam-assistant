/**
 * M02/F3：采集运行告警（持久化，重启不丢）。
 *
 * 告警事实存 PostgreSQL（sourcing_alerts），Redis 心跳与日志都不是告警
 * 事实来源。重复发生仅累加 occurrences 并刷新 lastSeenAt，不新增行；
 * 恢复（成功检查 / 心跳恢复）写 resolvedAt，保留历史可追溯。
 *
 * 触发点（无独立调度体系，全部挂在既有链路上）：
 * - CrawlRunStore.recordFailure：连续失败达到阈值 → consecutive_failures；
 * - CrawlRunStore.setHealth：structure_changed / blocked → 同名告警；
 * - CrawlRunStore.recordSuccess：该来源活跃告警全部解除；
 * - CrawlScheduler.tick → sweep()：来源到期未检查（超 2 个周期）→
 *   source_overdue（Worker 可能停止）；Worker 心跳过期 → worker_down；
 *   恢复后自动解除。
 */
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { CrawlHealthService, type WorkerStatus } from './crawl-health.service.js';

export const ALERT_TYPES = {
  consecutiveFailures: 'consecutive_failures',
  structureChanged: 'structure_changed',
  blocked: 'blocked',
  sourceOverdue: 'source_overdue',
  workerDown: 'worker_down',
} as const;

export type AlertType = (typeof ALERT_TYPES)[keyof typeof ALERT_TYPES];

export interface ActiveAlert {
  id: string;
  type: string;
  scope: string;
  sourceId: string | null;
  severity: string;
  message: string;
  occurrences: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** 来源到期未检查的阈值：超过 2 个调度周期未见 lastCheckedAt 推进 */
export const OVERDUE_PERIOD_MULTIPLIER = 2;

@Injectable()
export class SourcingAlertService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly health?: CrawlHealthService,
  ) {}

  /** 新增或刷新一条活跃告警（幂等：同 (type, sourceId) 只有一行） */
  async raise(input: {
    type: AlertType;
    sourceId?: string | null;
    severity?: 'warning' | 'critical';
    message: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const sourceId = input.sourceId ?? null;
    const data = {
      type: input.type,
      scope: sourceId ? 'source' : 'global',
      sourceId,
      severity: input.severity ?? 'warning',
      message: input.message,
    };
    // 复合唯一 (type, source_id) 含可空列：Prisma 复合唯一 where 不接受 null
    // （全局告警 sourceId=null），因此按 findFirst + create/update 实现；
    // 并发下唯一索引兜底，P2002 回落为 update。
    const existing = await this.prisma.sourcingAlert.findFirst({
      where: { type: input.type, sourceId },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.sourcingAlert.update({
        where: { id: existing.id },
        data: {
          ...data,
          resolvedAt: null,
          occurrences: { increment: 1 },
          lastSeenAt: now,
        },
      });
      return;
    }
    try {
      await this.prisma.sourcingAlert.create({
        data: { ...data, occurrences: 1, firstSeenAt: now, lastSeenAt: now },
      });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const row = await this.prisma.sourcingAlert.findFirst({
        where: { type: input.type, sourceId },
        select: { id: true },
      });
      if (!row) throw error;
      await this.prisma.sourcingAlert.update({
        where: { id: row.id },
        data: {
          ...data,
          resolvedAt: null,
          occurrences: { increment: 1 },
          lastSeenAt: now,
        },
      });
    }
  }

  /** 解除来源的全部活跃告警（检查成功后调用） */
  async resolveForSource(sourceId: string, now: Date = new Date()): Promise<void> {
    await this.prisma.sourcingAlert.updateMany({
      where: { sourceId, resolvedAt: null },
      data: { resolvedAt: now },
    });
  }

  /** 解除某类型全部活跃告警（Worker 心跳恢复等全局状态恢复） */
  async resolveByType(type: AlertType, now: Date = new Date()): Promise<void> {
    await this.prisma.sourcingAlert.updateMany({
      where: { type, resolvedAt: null },
      data: { resolvedAt: now },
    });
  }

  async listActive(): Promise<ActiveAlert[]> {
    return this.prisma.sourcingAlert.findMany({
      where: { resolvedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
    });
  }

  /**
   * 周期巡检（由 CrawlScheduler.tick 调用，不新增调度体系）：
   * - enabled 且到期的来源超过 2 个周期没有推进 → source_overdue；
   * - Worker 心跳过期 → worker_down（全局）。
   * 正常/恢复时解除对应告警。巡检内部异常只记日志，不影响投递主流程。
   */
  async sweep(now: Date = new Date()): Promise<void> {
    try {
      await this.sweepOverdueSources(now);
      await this.sweepWorkerHeartbeat(now);
    } catch {
      // 告警巡检失败不应影响调度投递；下一轮 tick 会重试。
    }
  }

  private async sweepOverdueSources(now: Date): Promise<void> {
    const sources = await this.prisma.source.findMany({
      where: { enabled: true, healthStatus: { notIn: ['paused', 'blocked'] } },
      select: {
        id: true,
        publisher: true,
        pollEveryMinutes: true,
        nextCheckAt: true,
        lastCheckedAt: true,
      },
    });
    const overdue = sources.filter((source) => {
      const deadline = source.nextCheckAt ?? source.lastCheckedAt;
      if (!deadline) return false;
      const overdueAfterMs =
        Math.max(1, source.pollEveryMinutes) *
        OVERDUE_PERIOD_MULTIPLIER *
        60_000;
      return now.getTime() - deadline.getTime() > overdueAfterMs;
    });

    const overdueIds = new Set(overdue.map((source) => source.id));
    for (const source of overdue) {
      await this.raise({
        type: ALERT_TYPES.sourceOverdue,
        sourceId: source.id,
        severity: 'critical',
        message: `来源「${source.publisher}」已超过 ${OVERDUE_PERIOD_MULTIPLIER} 个调度周期未检查，Worker 可能停止或调度受阻。`,
        now,
      });
    }
    // 解除已恢复来源的 overdue 告警（逐条 updateMany，避免误伤其它类型）
    const active = await this.prisma.sourcingAlert.findMany({
      where: { type: ALERT_TYPES.sourceOverdue, resolvedAt: null },
      select: { id: true, sourceId: true },
    });
    for (const alert of active) {
      if (alert.sourceId && !overdueIds.has(alert.sourceId)) {
        await this.prisma.sourcingAlert.update({
          where: { id: alert.id },
          data: { resolvedAt: now },
        });
      }
    }
  }

  private async sweepWorkerHeartbeat(now: Date): Promise<void> {
    if (!this.health) return;
    const status: WorkerStatus = await this.health.workerStatus(now);
    if (status.status === 'down') {
      await this.raise({
        type: ALERT_TYPES.workerDown,
        severity: 'critical',
        // workerStatus 的 lastSeenAt 已是 ISO 字符串（Redis 原始值）
        message:
          status.lastSeenAt
            ? `抓取 Worker 心跳过期（最后心跳 ${status.lastSeenAt}），持续采集已停止。`
            : '抓取 Worker 无心跳记录，持续采集未运行。',
        now,
      });
    } else {
      await this.resolveByType(ALERT_TYPES.workerDown, now);
    }
  }
}
