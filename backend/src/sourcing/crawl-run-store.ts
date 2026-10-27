/**
 * v7.2 工作包 4：抓取运行与来源健康的持久化访问（Seam）。
 *
 * 处理器与编排器只依赖本类暴露的方法，测试可注入内存假实现，
 * 不需要真实 PostgreSQL。队列（BullMQ/Redis）记录是运行基础设施，
 * 本表（CrawlRun）才是业务审计事实。
 */
import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service.js';
import { SourcingMetrics } from './observability.js';
import { ALERT_TYPES, SourcingAlertService } from './sourcing-alert.service.js';

export type SourceHealthStatus =
  'healthy' | 'degraded' | 'structure_changed' | 'blocked' | 'paused';

/** 连续失败达到该阈值即降级，暂停自动扩散 */
export const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/** 异常零结果的失败原因标识（成功抓取却 0 条发现且来源有历史发现） */
export const SUSPECTED_ZERO_RESULTS = 'suspected_zero_results';

/**
 * 静默 0 条判定（纯函数）：成功抓取却 0 条发现时，
 * 只有「该来源曾有历史发现」才视为异常零结果必须告警；
 * 新来源 0 条属正常冷启动，≥1 条发现则一切正常。
 */
export function shouldAlertZeroResults(
  hasHistoryDiscovery: boolean,
  discoveredCount: number,
): boolean {
  return discoveredCount === 0 && hasHistoryDiscovery;
}

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

/** 最近一次抓取运行的摘要（来源健康聚合用） */
export interface CrawlRunSummary {
  id: string;
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  discoveredCount: number;
  downloadedCount: number;
  unchangedCount: number;
  failedCount: number;
  adapterVersion: string | null;
  errorSummary: string | null;
}

/** GET /admin/sources/health 的单来源聚合视图 */
export interface SourceHealthSummary {
  id: string;
  publisher: string;
  officialUrl: string;
  enabled: boolean;
  adapterKey: string | null;
  healthStatus: string;
  consecutiveFailures: number;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  nextCheckAt: Date | null;
  lastFailReason: string | null;
  /** 最近一次运行（按 startedAt desc）；无运行时为 null */
  latestRun: CrawlRunSummary | null;
  /** 该来源最新一条 DocumentParseRun 的 parserVersion；无则 null */
  parserVersion: string | null;
  /** 待审核抽取积压（ExtractionRun status='pending_review' 数量） */
  pendingReviewCount: number;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter(
    (item): item is string => typeof item === 'string',
  );
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
  constructor(
    private readonly prisma: PrismaService,
    // 可选指标出口：测试缺省不传则完全不产生日志，行为与此前一致
    @Optional() private readonly metrics?: SourcingMetrics,
    // M02/F3：可选告警出口（持久化 sourcing_alerts）；不注入则只更新健康字段
    @Optional() private readonly alerts?: SourcingAlertService,
  ) {}

  async getSource(sourceId: string): Promise<SourceRecord | null> {
    const row = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });
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

  /** 锁住运行行后更新 URL 账本；并发 worker 与重放均不会丢失结果或重复累计。 */
  async recordFetchOutcome(
    runId: string,
    url: string,
    status: string,
    errorSummary?: string,
  ): Promise<void> {
    await this.updateFetchAudit(runId, (audit) => {
      const previous = audit.urls[url];
      if (status === 'queued' && previous) return;
      audit.urls[url] = {
        status:
          previous?.status === 'downloaded' && status === 'unchanged'
            ? 'downloaded'
            : status,
        ...(errorSummary ? { error: errorSummary.slice(0, 500) } : {}),
      };
    });
  }

  async completeDiscovery(runId: string, patch: CrawlRunPatch): Promise<void> {
    await this.updateFetchAudit(runId, (audit) => {
      audit.discovery = {
        status: patch.status,
        count: patch.discoveredCount ?? 0,
        failed: patch.failedCount ?? 0,
        error: patch.errorSummary ?? null,
      };
    });
  }

  private async updateFetchAudit(
    runId: string,
    mutate: (audit: {
      urls: Record<string, { status: string; error?: string }>;
      discovery?: {
        status: string;
        count: number;
        failed: number;
        error: string | null;
      };
    }) => void,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // UPDATE takes a PostgreSQL row lock for the duration of this transaction.
      const run = await tx.crawlRun.update({
        where: { id: runId },
        data: { updatedAt: new Date() },
      });
      const audit = (run.fetchAudit ?? { urls: {} }) as {
        urls: Record<string, { status: string; error?: string }>;
        discovery?: {
          status: string;
          count: number;
          failed: number;
          error: string | null;
        };
      };
      mutate(audit);
      const results = Object.values(audit.urls);
      const pending = results.some((item) =>
        ['queued', 'retrying'].includes(item.status),
      );
      const failures = results.filter((item) =>
        ['failed', 'blocked', 'structure_changed'].includes(item.status),
      );
      const complete =
        Boolean(audit.discovery) &&
        audit.discovery?.status !== 'retrying' &&
        !pending;
      const problem = failures.length > 0 || (audit.discovery?.failed ?? 0) > 0;
      const terminal = failures.some((item) => item.status === 'blocked')
        ? 'blocked'
        : failures.some((item) => item.status === 'structure_changed')
          ? 'structure_changed'
          : problem
            ? 'partial'
            : (audit.discovery?.status ?? 'running');
      await tx.crawlRun.update({
        where: { id: runId },
        data: {
          fetchAudit: audit,
          status: complete ? terminal : 'running',
          finishedAt: complete ? new Date() : null,
          discoveredCount: audit.discovery?.count ?? run.discoveredCount,
          downloadedCount: results.filter(
            (item) => item.status === 'downloaded',
          ).length,
          unchangedCount: results.filter((item) => item.status === 'unchanged')
            .length,
          failedCount: failures.length + (audit.discovery?.failed ?? 0),
          errorSummary:
            [audit.discovery?.error, ...failures.map((item) => item.error)]
              .filter(Boolean)
              .join('; ')
              .slice(0, 500) || null,
        },
      });
    });
  }

  /** 下载阶段在同一次运行上累加计数器（下载/未变化/失败） */
  async recordRunFailure(runId: string, summary: string): Promise<void> {
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: {
        failedCount: { increment: 1 },
        errorSummary: summary.slice(0, 500),
      },
    });
  }

  async recordRunCounters(
    runId: string,
    counters: CrawlRunCounters,
  ): Promise<void> {
    await this.prisma.crawlRun.update({
      where: { id: runId },
      data: {
        ...(counters.downloaded
          ? { downloadedCount: { increment: counters.downloaded } }
          : {}),
        ...(counters.unchanged
          ? { unchangedCount: { increment: counters.unchanged } }
          : {}),
        ...(counters.failed
          ? { failedCount: { increment: counters.failed } }
          : {}),
      },
    });
  }

  async incrementRunCounters(
    runId: string,
    counters: CrawlRunCounters,
  ): Promise<void> {
    await this.recordRunCounters(runId, counters);
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
    // M02/F3：检查成功即解除该来源全部活跃告警（连续失败/结构变化/超期）
    if (this.alerts) {
      try {
        await this.alerts.resolveForSource(sourceId, input.checkedAt);
      } catch {
        // 告警解除失败不影响健康记录主流程
      }
    }
  }

  /**
   * 失败：累计连续失败；达到阈值降级或按错误类型标注健康状态。
   *
   * M02/F3 退避：计入来源的失败按「周期 × 2^(连续失败-1)，封顶 8 倍」推迟
   * 下次检查（1 次→1x、2 次→2x、3 次→4x、4 次以上→8x），避免对故障来源
   * 每个周期都重击；不计入来源的基础设施失败（countTowardsSource=false）
   * 沿用调用方给定的常规周期。达到降级阈值时落一条持久化告警。
   */
  async recordFailure(
    sourceId: string,
    input: {
      checkedAt: Date;
      nextCheckAt?: Date;
      reason: string;
      healthStatus?: SourceHealthStatus;
      /** 不可用基础设施（如 Redis）不应计入来源连续失败 */
      countTowardsSource?: boolean;
    },
  ): Promise<void> {
    const source = await this.getSource(sourceId);
    const prev = source?.consecutiveFailures ?? 0;
    const countsTowards = input.countTowardsSource ?? true;
    const next = countsTowards ? prev + 1 : prev;
    const health =
      input.healthStatus ??
      (next >= CONSECUTIVE_FAILURE_THRESHOLD ? 'degraded' : undefined);
    const pollEveryMinutes = Math.max(1, source?.pollEveryMinutes ?? 60);
    // 调用方显式给定的 nextCheckAt 优先（如基础设施失败沿用常规周期）；
    // 否则计入来源的失败按指数退避，不计入的失败按常规周期。
    const nextCheckAt =
      input.nextCheckAt ??
      (countsTowards
        ? this.nextRetryCheckAt(input.checkedAt, pollEveryMinutes, next)
        : this.nextCheckAt(input.checkedAt, pollEveryMinutes));
    await this.prisma.source.update({
      where: { id: sourceId },
      data: {
        lastCheckedAt: input.checkedAt,
        nextCheckAt,
        lastFailReason: input.reason,
        consecutiveFailures: next,
        ...(health ? { healthStatus: health } : {}),
      },
    });
    // 连续失败增长是告警信号；基础设施不可用（countTowardsSource=false）不重复上报
    if (countsTowards && next >= 1) {
      this.metrics?.consecutiveFailures({ sourceId, count: next });
    }
    // M02/F3：达到降级阈值 → 持久化告警（重启不丢，成功后自动解除）
    if (countsTowards && next >= CONSECUTIVE_FAILURE_THRESHOLD && this.alerts) {
      try {
        await this.alerts.raise({
          type: ALERT_TYPES.consecutiveFailures,
          sourceId,
          severity: 'critical',
          message: `来源「${source?.publisher ?? sourceId}」连续失败 ${next} 次（最近原因：${input.reason}），已降级待人工关注。`,
          now: input.checkedAt,
        });
      } catch {
        // 告警写入失败不影响健康记录主流程
      }
    }
  }

  /**
   * M02/F3：失败退避的下一次检查时间。
   * 延迟 = 周期 × min(2^(连续失败-1), 8)，下限 1 分钟。
   */
  nextRetryCheckAt(
    now: Date,
    pollEveryMinutes: number,
    consecutiveFailures: number,
  ): Date {
    const multiplier = Math.min(Math.pow(2, Math.max(1, consecutiveFailures) - 1), 8);
    const delayMs = Math.max(1, pollEveryMinutes) * multiplier * 60_000;
    return new Date(now.getTime() + delayMs);
  }

  /** 结构变化（DOM 失配）与人工暂停等显式健康状态 */
  async setHealth(
    sourceId: string,
    healthStatus: SourceHealthStatus,
    reason: string,
  ): Promise<void> {
    const source = await this.getSource(sourceId);
    await this.prisma.source.update({
      where: { id: sourceId },
      data: { healthStatus, lastFailReason: reason },
    });
    // M02/F3：结构变化与转人工都需要人工介入 → 持久化告警
    if (
      this.alerts &&
      (healthStatus === 'structure_changed' || healthStatus === 'blocked')
    ) {
      try {
        await this.alerts.raise({
          type:
            healthStatus === 'structure_changed'
              ? ALERT_TYPES.structureChanged
              : ALERT_TYPES.blocked,
          sourceId,
          severity: 'critical',
          message: `来源「${source?.publisher ?? sourceId}」${healthStatus === 'structure_changed' ? '页面结构变化，适配器失配' : '被反爬阻断（验证码/登录/封禁），已转人工'}：${reason}`,
        });
      } catch {
        // 告警写入失败不影响健康记录主流程
      }
    }
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

  /** 近窗口内的进行中运行（queued/running）：重复点击受控；超窗运行视为僵尸不阻塞 */
  async findActiveRun(
    sourceId: string,
    since: Date,
  ): Promise<{ id: string } | null> {
    const row = await this.prisma.crawlRun.findFirst({
      where: {
        sourceId,
        status: { in: ['queued', 'running'] },
        startedAt: { gte: since },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    return row ?? null;
  }

  /** 该来源是否曾有历史发现：逻辑文档存在，或历史运行发现过 ≥1 条 */
  async hasHistoryDiscovery(sourceId: string): Promise<boolean> {
    const document = await this.prisma.sourceDocument.findFirst({
      where: { sourceId },
      select: { id: true },
    });
    if (document) return true;
    const run = await this.prisma.crawlRun.findFirst({
      where: { sourceId, discoveredCount: { gt: 0 } },
      select: { id: true },
    });
    return Boolean(run);
  }

  async listRuns(sourceId: string, limit = 20) {
    return this.prisma.crawlRun.findMany({
      where: { sourceId },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * 来源健康聚合视图：来源自身字段 + 最近一次运行 + 最新解析器版本 +
   * 待审核积压，供 GET /admin/sources/health 一次返回。
   */
  async listHealth(): Promise<SourceHealthSummary[]> {
    const sources = await this.prisma.source.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        publisher: true,
        officialUrl: true,
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
    return Promise.all(
      sources.map(async (source) => {
        const [latestRun, latestParse, pendingReviewCount] = await Promise.all([
          this.prisma.crawlRun.findFirst({
            where: { sourceId: source.id },
            orderBy: { startedAt: 'desc' },
            select: {
              id: true,
              status: true,
              trigger: true,
              startedAt: true,
              finishedAt: true,
              discoveredCount: true,
              downloadedCount: true,
              unchangedCount: true,
              failedCount: true,
              adapterVersion: true,
              errorSummary: true,
            },
          }),
          // DocumentParseRun 经 SourceSnapshot 关联到来源
          this.prisma.documentParseRun.findFirst({
            where: { snapshot: { sourceId: source.id } },
            orderBy: { createdAt: 'desc' },
            select: { parserVersion: true },
          }),
          this.prisma.extractionRun.count({
            where: {
              status: 'pending_review',
              snapshot: { sourceId: source.id },
            },
          }),
        ]);
        return {
          ...source,
          latestRun,
          parserVersion: latestParse?.parserVersion ?? null,
          pendingReviewCount,
        };
      }),
    );
  }

  /** 下次检查时间 = 现在 + 周期（分钟） */
  nextCheckAt(now: Date, pollEveryMinutes: number): Date {
    return new Date(now.getTime() + Math.max(1, pollEveryMinutes) * 60_000);
  }
}
