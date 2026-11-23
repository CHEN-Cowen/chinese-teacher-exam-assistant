/**
 * v7.2 工作包 4：抓取运维接口（管理员）。
 *
 * 对外只暴露“按 sourceId + trigger 检查来源”的能力，以及来源健康/运行审计查询；
 * 不暴露队列内部结构，也不在 API 进程内执行任何抓取或解析。
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, StrictAdminGuard } from '../auth/admin.guard.js';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlRunStore } from './crawl-run-store.js';
import { SourceDocumentStore } from './source-document-store.js';
import { CrawlHealthService } from './crawl-health.service.js';
import { SourcingAlertService } from './sourcing-alert.service.js';
import { SourcingMetrics } from './observability.js';
import { SnapshotRetentionService } from './snapshot-retention.js';
import type {
  CrawlTrigger,
  CrawlTaskQueue,
  QueueJobCounts,
} from './jobs/task-queue.js';
import {
  SOURCE_CATALOG,
  SOURCE_MONITORING_RECORDS,
  getCatalogSourceKeys,
  getSeedableSources,
  validateSourceCatalog,
} from './source-catalog.js';
import { summarizeAllMonitoring } from './source-monitoring.js';
import { CRAWL_TASK_QUEUE } from './sourcing.tokens.js';
import { PrismaCrawlBudgetStore } from './crawl-budget.store.js';
import {
  TrialBudgetValidationError,
  resolveTrialBudget,
  type TrialBudgetLimits,
} from './crawl-budget.js';
import {
  CONFIRMED_RELATION_TYPES,
  type RelationKind,
} from '../announcements/relation.domain.js';

/** 人工触发只允许 admin / retry；schedule 只由定时器产生 */
const MANUAL_TRIGGERS: readonly CrawlTrigger[] = ['admin', 'retry'];

@Controller('admin/sources')
export class SourcingController {
  private readonly logger = new Logger(SourcingController.name);

  constructor(
    private readonly orchestrator: CrawlOrchestrator,
    private readonly store: CrawlRunStore,
    private readonly documents: SourceDocumentStore,
    @Inject(CRAWL_TASK_QUEUE) private readonly queue: CrawlTaskQueue,
    private readonly metrics: SourcingMetrics,
    private readonly healthService: CrawlHealthService,
    private readonly alerts: SourcingAlertService,
    private readonly retention: SnapshotRetentionService,
    @Optional() private readonly budget?: PrismaCrawlBudgetStore,
  ) {}

  // ==================== v7.2：公告关系（补充/延期/取消）人工确认 ====================
  // 声明在 ':sourceId/runs' 之前，避免静态段被路径参数捕获。

  /** 待人工确认的关系队列（relationType 以 Candidate 结尾的文档） */
  @Get('relations/pending')
  @UseGuards(AdminGuard)
  async pendingRelations() {
    return { relations: await this.documents.listPendingRelations() };
  }

  /** 人工确认关系：候选 → 确定值（supplement/delay/cancel） */
  @Post('documents/:documentId/relation')
  @UseGuards(AdminGuard)
  async confirmRelation(
    @Param('documentId') documentId: string,
    @Body() body: { relationType: string; parentDocumentId: string },
  ) {
    if (!CONFIRMED_RELATION_TYPES.includes(body.relationType)) {
      throw new BadRequestException(
        `relationType 必须是确定关系值（${CONFIRMED_RELATION_TYPES.join('/')}）`,
      );
    }
    if (!body.parentDocumentId) {
      throw new BadRequestException('parentDocumentId 不能为空');
    }
    const document = await this.documents.confirmRelation(documentId, {
      relationType: body.relationType as RelationKind,
      parentDocumentId: body.parentDocumentId,
    });
    return { document };
  }

  /**
   * 候选目录不等于已监测覆盖；只读返回核验状态。
   *
   * 每个来源附带 `monitoring`（来源级检查记录推导出的状态），
   * 便于直接看出“核验通过”与“已在持续监测”的差别——两者不是一回事。
   */
  @Get('catalog')
  @UseGuards(AdminGuard)
  catalog() {
    const monitoring = summarizeAllMonitoring(
      SOURCE_MONITORING_RECORDS,
      getCatalogSourceKeys(),
    );
    const byKey = new Map(monitoring.map((entry) => [entry.sourceKey, entry]));
    return {
      entries: SOURCE_CATALOG.map((entry) => ({
        ...entry,
        monitoring: byKey.get(entry.sourceKey)!,
      })),
      validationErrors: validateSourceCatalog(),
    };
  }

  /** 仅登记通过配置核验门禁的来源，不启用未核验候选。 */
  @Post('seed')
  @UseGuards(StrictAdminGuard)
  async seed() {
    const errors = validateSourceCatalog();
    if (errors.length) throw new BadRequestException(errors.join('; '));
    const registered = [];
    for (const source of getSeedableSources()) {
      registered.push(
        await this.store.upsertSource({
          publisher: source.publisher,
          officialUrl: source.officialUrl,
          regionCode: source.regionCode,
          adapterKey: source.adapterKey,
          listUrls: source.listUrls,
          allowedHosts: source.allowedHosts,
          pollEveryMinutes: source.pollEveryMinutes,
        }),
      );
    }
    return { count: registered.length, sources: registered };
  }

  // ==================== 快照保留策略（单机磁盘保护） ====================
  // 声明在任何 ':sourceId' 路由之前，避免静态段被路径参数捕获。

  /**
   * 只读预演：算出会删多少条、能回收多少字节，不做任何修改。
   * 迁移回本地磁盘或磁盘告警时先用它看规模。
   */
  @Get('snapshots/retention/plan')
  @UseGuards(AdminGuard)
  async retentionPlan(
    @Query('keep') keep?: string,
    @Query('minAgeDays') minAgeDays?: string,
    @Query('limit') limit?: string,
  ) {
    return this.retention.prune(
      {
        keepVersions: keep === undefined ? undefined : Number(keep),
        minAgeDays: minAgeDays === undefined ? undefined : Number(minAgeDays),
        scanLimit: limit === undefined ? undefined : Number(limit),
      },
      true,
    );
  }

  /**
   * 执行清理。dryRun 默认取 SNAPSHOT_RETENTION_DRY_RUN（未设置时为 true），
   * 因此不带 body 调用只会再跑一次预演；必须显式传 {"dryRun": false} 才真删。
   */
  @Post('snapshots/retention/run')
  @UseGuards(StrictAdminGuard)
  async retentionRun(
    @Body()
    body: {
      keepVersions?: number;
      minAgeDays?: number;
      scanLimit?: number;
      dryRun?: boolean;
    } = {},
  ) {
    if (body.dryRun === false && body.keepVersions !== undefined) {
      if (!Number.isFinite(body.keepVersions) || body.keepVersions < 1) {
        throw new BadRequestException('keepVersions 必须是 ≥1 的整数');
      }
    }
    return this.retention.prune(
      {
        keepVersions: body.keepVersions,
        minAgeDays: body.minAgeDays,
        scanLimit: body.scanLimit,
      },
      body.dryRun,
    );
  }

  /**
   * 按运行停止试跑：本次待执行任务在 Worker 取到时跳过，正在执行的任务
   * 在下一次 HTTP 请求闸门处终止，且不再派生附件/解析/抽取任务。
   *
   * 只影响指定 runId；不删除队列、不动其它运行与历史失败记录。
   */
  @Post('runs/:runId/stop')
  @UseGuards(AdminGuard)
  async stopRun(
    @Param('runId') runId: string,
    @Body() body: { reason?: string } = {},
  ) {
    if (!this.budget) {
      throw new BadRequestException('试跑预算组件未配置');
    }
    const reason = body.reason?.slice(0, 200) || 'stopped_by_admin';
    const snapshot = await this.budget.stop(runId, reason);
    if (!snapshot) throw new NotFoundException(`未找到试跑预算：${runId}`);
    await this.store.markRunStopped(runId, reason);
    return { runId, stopped: true, budget: snapshot };
  }

  /** 查询试跑预算的执行口径：已用/剩余/预算内未覆盖量 */
  @Get('runs/:runId/budget')
  @UseGuards(AdminGuard)
  async runBudget(@Param('runId') runId: string) {
    if (!this.budget) {
      throw new BadRequestException('试跑预算组件未配置');
    }
    const snapshot = await this.budget.get(runId);
    if (!snapshot) throw new NotFoundException(`未找到试跑预算：${runId}`);
    return { budget: snapshot };
  }

  /** 手动检查来源；trigger 缺省为 admin，重试失败来源用 retry */
  @Post(':sourceId/check')
  @UseGuards(AdminGuard)
  async check(
    @Param('sourceId') sourceId: string,
    @Body()
    body: {
      trigger?: string;
      /** 手动试跑：开启预算约束（默认值=1 页/3 详情/每篇 2 附件/整轮 6 附件/20 请求） */
      trial?: boolean;
      /** 覆盖默认预算；服务端会按硬上限校验并拒绝越界值 */
      budget?: Partial<TrialBudgetLimits>;
    } = {},
  ) {
    const trigger = (body.trigger ?? 'admin') as CrawlTrigger;
    if (!MANUAL_TRIGGERS.includes(trigger)) {
      throw new BadRequestException(
        `手动触发只接受 admin / retry，收到：${body.trigger}`,
      );
    }
    let trialBudget: TrialBudgetLimits | undefined;
    if (body.trial || body.budget) {
      try {
        trialBudget = resolveTrialBudget(body.budget);
      } catch (error) {
        if (error instanceof TrialBudgetValidationError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
      if (!this.budget) {
        throw new BadRequestException('试跑预算组件未配置，拒绝无预算试跑');
      }
    }
    return this.orchestrator.checkSource(sourceId, trigger, {
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ...(trialBudget ? { trialBudget } : {}),
    });
  }

  /** 暂停来源：停止自动抓取（保留历史审计，不删除数据） */
  @Post(':sourceId/pause')
  @UseGuards(AdminGuard)
  async pause(@Param('sourceId') sourceId: string) {
    await this.store.setPaused(sourceId, true);
    return { sourceId, paused: true };
  }

  /** 恢复来源：重新纳入定时与手动抓取 */
  @Post(':sourceId/resume')
  @UseGuards(AdminGuard)
  async resume(@Param('sourceId') sourceId: string) {
    await this.store.setPaused(sourceId, false);
    return { sourceId, paused: false };
  }

  /**
   * 来源健康概览：连续失败、健康状态、下次检查时间、最近一次运行、
   * 最新解析器版本、待审核积压；queue 为队列积压计数（队列不可用时为 null）。
   *
   * M02/F3：补充 worker（Redis 心跳推导）与 activeAlerts（持久化运行告警），
   * 与公开覆盖投影（coverage-projection）共用 Source 表同一份运行事实。
   */
  @Get('health')
  @UseGuards(AdminGuard)
  async health() {
    const [sources, queue, worker, activeAlerts] = await Promise.all([
      this.store.listHealth(),
      this.queueBacklog(),
      this.healthService.workerStatus().catch(() => null),
      this.alerts.listActive().catch(() => null),
    ]);
    return { sources, queue, worker, activeAlerts };
  }

  /** 队列积压计数：实现不支持或 Redis 不可用时降级为 null（不拖垮健康接口） */
  private async queueBacklog(): Promise<QueueJobCounts | null> {
    if (!this.queue.getJobCounts) return null;
    try {
      const counts = await this.queue.getJobCounts();
      this.metrics.queueBacklog(counts);
      return counts;
    } catch (error) {
      this.logger.warn(
        `队列计数不可用：${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** 指定来源的抓取运行审计（业务事实，非队列记录） */
  @Get(':sourceId/runs')
  @UseGuards(AdminGuard)
  async runs(
    @Param('sourceId') sourceId: string,
    @Query('limit') limit?: string,
  ) {
    const take = Number(limit) > 0 ? Math.min(Number(limit), 100) : 20;
    return { runs: await this.store.listRuns(sourceId, take) };
  }

  /** 指定来源下的逻辑文档列表（v7.2：公告关系审核入口） */
  @Get(':sourceId/documents')
  @UseGuards(AdminGuard)
  async listDocuments(@Param('sourceId') sourceId: string) {
    return { documents: await this.documents.listDocuments(sourceId) };
  }
}
