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
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard, StrictAdminGuard } from '../auth/admin.guard.js';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlRunStore } from './crawl-run-store.js';
import type { CrawlTrigger } from './jobs/task-queue.js';
import { DEFAULT_CRAWL_SOURCES } from './default-sources.js';

/** 人工触发只允许 admin / retry；schedule 只由定时器产生 */
const MANUAL_TRIGGERS: readonly CrawlTrigger[] = ['admin', 'retry'];

@Controller('admin/sources')
export class SourcingController {
  constructor(
    private readonly orchestrator: CrawlOrchestrator,
    private readonly store: CrawlRunStore,
  ) {}

  /** 幂等登记首批三个来源（对照真实官网核对栏目 URL 后调用） */
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

  /** 来源健康概览：连续失败、健康状态、下次检查时间 */
  @Get('health')
  @UseGuards(AdminGuard)
  async health() {
    return { sources: await this.store.listHealth() };
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
}
