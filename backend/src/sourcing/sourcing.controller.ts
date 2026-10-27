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

  /** 手动检查来源；trigger 缺省为 admin，重试失败来源用 retry */
  @Post(':sourceId/check')
  @UseGuards(AdminGuard)
  async check(
    @Param('sourceId') sourceId: string,
    @Body() body: { trigger?: string } = {},
  ) {
    const trigger = (body.trigger ?? 'admin') as CrawlTrigger;
    if (!MANUAL_TRIGGERS.includes(trigger)) {
      throw new BadRequestException(
        `手动触发只接受 admin / retry，收到：${body.trigger}`,
      );
    }
    return this.orchestrator.checkSource(sourceId, trigger, {
      nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
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
