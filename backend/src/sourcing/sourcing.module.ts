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

@Module({
  imports: [SourcingCoreModule, NestScheduleModule.forRoot()],
  controllers: [SourcingController],
  providers: [CrawlOrchestrator, CrawlScheduler],
  // CrawlHealthService 由 SourcingCoreModule 提供并导出；Nest 不允许模块直接
  // 导出非自身 providers 的 provider（UnknownExportException），因此通过
  // 重新导出 SourcingCoreModule 让上层（HealthController 所在 AppModule）获得它。
  // 注意：不要在两个模块重复注册 CrawlHealthService，否则会出现两个 Redis 连接。
  exports: [CrawlOrchestrator, SourcingCoreModule],
})
export class SourcingModule {}
