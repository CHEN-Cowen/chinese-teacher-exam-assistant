/**
 * v7.2 工作包 4：主动抓取来源模块（API 进程）。
 *
 * 对外只暴露 CrawlOrchestrator.checkSource(sourceId, trigger)，以及
 * 运维接口（手动触发/暂停/健康/审计）与定时投递器。
 * 真正的抓取与解析在独立 Worker 进程（sourcing-worker.module.ts）中执行。
 */
import { Module } from '@nestjs/common';
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule';
import { SourcingCoreModule } from './sourcing-core.module.js';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlScheduler } from './crawl-scheduler.js';
import { SourcingController } from './sourcing.controller.js';
import { CrawlHealthService } from './crawl-health.service.js';

@Module({
  imports: [SourcingCoreModule, NestScheduleModule.forRoot()],
  controllers: [SourcingController],
  providers: [CrawlOrchestrator, CrawlScheduler],
  exports: [CrawlOrchestrator, CrawlHealthService],
})
export class SourcingModule {}
