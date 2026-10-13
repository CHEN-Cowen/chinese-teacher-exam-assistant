/**
 * v7.2 工作包 4：抓取运行与来源健康的持久化访问（Seam）。
 *
 * 处理器与编排器只依赖本类暴露的方法，测试可注入内存假实现，
 * 不需要真实 PostgreSQL。队列（BullMQ/Redis）记录是运行基础设施，
 * 本表（CrawlRun）才是业务审计事实。
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';

export type SourceHealthStatus =
  | 'healthy'
  | 'degraded'
  | 'structure_changed'
  | 'blocked'
  | 'paused';

/** 连续失败达到该阈值即降级，暂停自动扩散 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

export interface SourceRecord {
  id: string;
  publisher: string;
  officialUrl: string;
  enabled: boolean;
  adapterKey: string | null;
  listUrls: string[] | null;
  allowedHosts: string[] | null;
  pollEveryMinutes: number;
  nextCheckAt: Date | null;
  healthStatus: string;
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  etag: string | null;
  lastModified: string | null;
}

export interface CrawlRunPatch {
  status: string;
  finishedAt?: Date;
  discoveredCount?: number;
  downloadedCount?: number;
  unchangedCount?: number;
  failedCount?: number;
  errorSummary?: string | null;
  adapterVersion?: string;
}

export interface CrawlRunCounters {
  downloaded?: number;
  unchanged?: number;
  failed?: number;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is string => typeof item === 'string');
  return items.length > 0 ? items : null;
}

/** 从 Prisma 行构造领域记录（Json 字段收敛为 string[]） */
export function toSourceRecord(row: {
  id: string;
  publisher: string;
  officialUrl: string;
  enabled: boolean;
  adapterKey: string | null;
  listUrls: unknown;
  allowedHosts: unknown;
  pollEveryMinutes: number;
  nextCheckAt: Date | null;
  healthStatus: string;
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  etag: string | null;
  lastModified: string | null;
}): SourceRecord {
  return {
    id: row.id,
    publisher: row.publisher,
    officialUrl: row.officialUrl,
    enabled: row.enabled,
    adapterKey: row.adapterKey,
    listUrls: toStringArray(row.listUrls),
    allowedHosts: toStringArray(row.allowedHosts),
    pollEveryMinutes: row.pollEveryMinutes,
    nextCheckAt: row.nextCheckAt,
    healthStatus: row.healthStatus,
    consecutiveFailures: row.consecutiveFailures,
    lastCheckedAt: row.lastCheckedAt,
    etag: row.etag,
    lastModified: row.lastModified,
  };
}

@Injectable()
export class CrawlRunStore {
  constructor(private readonly prisma: PrismaService) {}

  async getSource(sourceId: string): Promise<SourceRecord | null> {
    const row = await this.prisma.source.findUnique({ where: { id: sourceId } });
    return row ? toSourceRecord(row) : null;
  }

  /** 幂等登记来源（按 officialUrl 去重）：供首批来源初始化与配置更新 */
  async upsertSource(input: {
    publisher: string;
    officialUrl: string;
    sourceType?: string;
    regionCode?: string | null;
    adapterKey: string;
    listUrls: string[];
    allowedHosts: string[];
    pollEveryMinutes?: number;
  }): Promise<SourceRecord> {
    const data = {
      publisher: input.publisher,
      officialUrl: input.officialUrl,
      sourceType: input.sourceType ?? 'government',
      regionCode: input.regionCode ?? null,
      adapterKey: input.adapterKey,
      listUrls: input.listUrls,
      allowedHosts: input.allowedHosts,
      pollEveryMinutes: input.pollEveryMinutes ?? 60,
    };
    const existing = await this.prisma.source.findFirst({
      where: { officialUrl: input.officialUrl },
    });
    const row = existing
      ? await this.prisma.source.update({ where: { id: existing.id }, data })
      : await this.prisma.source.create({ data });
    return toSourceRecord(row);
  }

  /** 到期可检查的来源：启用、非人工暂停/封禁、且 nextCheckAt 已到（或为空） */
  async listDueSources(now: Date, limit = 50): Promise<SourceRecord[]> {
    const rows = await this.prisma.source.findMany({
      where: {
        enabled: true,
        // paused=人工暂停；blocked=验证码/登录/封禁待人工处理，二者都不再自动抓取
        healthStatus: { notIn: ['paused', 'blocked'] },
        OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
      },
      orderBy: { nextCheckAt: 'asc' },
      take: limit,
    });
    return rows.map(toSourceRecord);
  }

  async createRun(input: {
    sourceId: string;
    trigger: string;
    adapterVersion?: string;
  }): Promise<{ id: string }> {
    const row = await this.prisma.crawlRun.create({
      data: {
        sourceId: input.sourceId,
        trigger: input.trigger,
        status: 'queued',
        adapterVersion: input.adapterVersion,
      },
      select: { id: true },
    });
    return row;
  }

  async finishRun(runId: string, patch: CrawlRunPatch): Promise<void> {
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: {
        status: patch.status,
        finishedAt: patch.finishedAt ?? new Date(),
        ...(patch.discoveredCount !== undefined
          ? { discoveredCount: patch.discoveredCount }
          : {}),
        ...(patch.downloadedCount !== undefined
          ? { downloadedCount: patch.downloadedCount }
          : {}),
        ...(patch.unchangedCount !== undefined
          ? { unchangedCount: patch.unchangedCount }
          : {}),
        ...(patch.failedCount !== undefined
          ? { failedCount: patch.failedCount }
          : {}),
        ...(patch.errorSummary !== undefined
          ? { errorSummary: patch.errorSummary }
          : {}),
        ...(patch.adapterVersion !== undefined
          ? { adapterVersion: patch.adapterVersion }
          : {}),
      },
    });
  }

  /** 下载阶段在同一次运行上累加计数器（下载/未变化/失败） */
  async incrementRunCounters(
    runId: string,
    counters: CrawlRunCounters,
  ): Promise<void> {
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: {
        ...(counters.downloaded ? { downloadedCount: { increment: counters.downloaded } } : {}),
        ...(counters.unchanged ? { unchangedCount: { increment: counters.unchanged } } : {}),
        ...(counters.failed ? { failedCount: { increment: counters.failed } } : {}),
      },
    });
  }

  /** 记录一次检查发生（不等于成功发现），并安排下次检查 */
  async recordCheck(
    sourceId: string,
    input: { checkedAt: Date; nextCheckAt: Date },
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { lastCheckedAt: input.checkedAt, nextCheckAt: input.nextCheckAt },
    });
  }

  async recordSuccess(
    sourceId: string,
    input: { checkedAt: Date; nextCheckAt: Date },
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        lastCheckedAt: input.checkedAt,
        nextCheckAt: input.nextCheckAt,
        lastSuccessAt: input.checkedAt,
        lastFailReason: null,
        healthStatus: 'healthy',
        consecutiveFailures: 0,
      },
    });
  }

  /** 失败：累计连续失败；达到阈值降级或按错误类型标注健康状态 */
  async recordFailure(
    sourceId: string,
    input: {
      checkedAt: Date;
      nextCheckAt: Date;
      reason: string;
      healthStatus?: SourceHealthStatus;
      /** 不可用基础设施（如 Redis）不应计入来源连续失败 */
      countTowardsSource?: boolean;
    },
  ): Promise<void> {
    const source = await this.getSource(sourceId);
    const prev = source?.consecutiveFailures ?? 0;
    const next = (input.countTowardsSource ?? true) ? prev + 1 : prev;
    const health =
      input.healthStatus ??
      (next >= CONSECUTIVE_FAILURE_THRESHOLD ? 'degraded' : undefined);
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        lastCheckedAt: input.checkedAt,
        nextCheckAt: input.nextCheckAt,
        lastFailReason: input.reason,
        consecutiveFailures: next,
        ...(health ? { healthStatus: health } : {}),
      },
    });
  }

  /** 结构变化（DOM 失配）与人工暂停等显式健康状态 */
  async setHealth(
    sourceId: string,
    healthStatus: SourceHealthStatus,
    reason: string,
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { healthStatus, lastFailReason: reason },
    });
  }

  /** 写入栏目页的条件请求缓存（ETag / Last-Modified），供下一轮 304 判断 */
  async updateConditionalHeaders(
    sourceId: string,
    input: { etag: string | null; lastModified: string | null },
  ): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { etag: input.etag, lastModified: input.lastModified },
    });
  }

  async setPaused(sourceId: string, paused: boolean): Promise<void> {
    await this.prisma.source.update({
      where: { id: sourceId },
      data: paused
        ? { enabled: false, healthStatus: 'paused' }
        : { enabled: true, healthStatus: 'healthy', consecutiveFailures: 0 },
    });
  }

  async listRuns(sourceId: string, limit = 20) {
    return this.prisma.crawlRun.findMany({
      where: { sourceId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async listHealth() {
    return this.prisma.source.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        publisher: true,
        enabled: true,
        adapterKey: true,
        healthStatus: true,
        consecutiveFailures: true,
        lastCheckedAt: true,
        lastSuccessAt: true,
        nextCheckAt: true,
        lastFailReason: true,
      },
    });
  }

  /** 下次检查时间 = 现在 + 周期（分钟） */
  nextCheckAt(now: Date, pollEveryMinutes: number): Date {
    return new Date(now.getTime() + Math.max(1, pollEveryMinutes) * 60_000);
  }
}
