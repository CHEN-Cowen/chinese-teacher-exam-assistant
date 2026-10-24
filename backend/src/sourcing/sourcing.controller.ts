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
import { SourcingMetrics } from './observability.js';
import type {
  CrawlTrigger,
  CrawlTaskQueue,
  QueueJobCounts,
} from './jobs/task-queue.js';
import { DEFAULT_CRAWL_SOURCES } from './default-sources.js';
import { CRAWL_TASK_QUEUE } from './sourcing.tokens.js';
import { CONFIRMED_RELATION_TYPES, type RelationKind } from '../announcements/relation.domain.js';

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

  /** 幂等登记 S4 首批四个来源（对照真实官网核对栏目 URL 后调用） */
  @Post('seed')
  @UseGuards(StrictAdminGuard)
  async seed() {
    const registered = [];
    for (const source of DEFAULT_CRAWL_SOURCES) {
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
   */
  @Get('health')
  @UseGuards(AdminGuard)
  async health() {
    const [sources, queue] = await Promise.all([
      this.store.listHealth(),
      this.queueBacklog(),
    ]);
    return { sources, queue };
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
