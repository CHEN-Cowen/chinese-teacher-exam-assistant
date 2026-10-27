/**
 * v7.2 工作包 4：定时投递器（@nestjs/schedule）。
 *
 * 只负责“按来源到期时间把发现任务投递进队列”，不做任何抓取或解析。
 * 真正的抓取/解析在独立 Worker 进程中执行。
 *
 * - 单来源失败隔离：某个来源检查抛错不中断整轮投递；
 * - 重入保护：上一轮未结束则跳过本轮，避免堆积；
 * - 可用 CRAWL_SCHEDULER_ENABLED=false 关闭定时（例如仅手动运维）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CrawlOrchestrator } from './crawl-orchestrator.js';
import { CrawlRunStore } from './crawl-run-store.js';
import { SourcingAlertService } from './sourcing-alert.service.js';

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** 投递轮询间隔（毫秒）：默认每分钟扫描一次到期来源 */
const TICK_INTERVAL_MS = intFromEnv(process.env.CRAWL_SCHEDULER_INTERVAL_MS, 60_000);
/** 单轮最多投递的来源数 */
const TICK_BATCH_SIZE = intFromEnv(process.env.CRAWL_SCHEDULER_BATCH, 20);

@Injectable()
export class CrawlScheduler {
  private readonly logger = new Logger(CrawlScheduler.name);
  private readonly enabled = process.env.CRAWL_SCHEDULER_ENABLED !== 'false';
  private ticking = false;

  constructor(
    private readonly orchestrator: CrawlOrchestrator,
    private readonly store: CrawlRunStore,
    // M02/F3：运行告警巡检挂在既有调度 tick 上，不新增调度体系
    private readonly alerts: SourcingAlertService,
  ) {}

  @Interval('crawl-due-sources', TICK_INTERVAL_MS)
  async tick(): Promise<void> {
    if (!this.enabled || this.ticking) return;
    this.ticking = true;
    try {
      // 告警巡检先行：来源超期/Worker 停止先落告警，再尝试投递。
      // 巡检自身失败不应阻塞投递主流程（下一轮 tick 重试）。
      try {
        await this.alerts.sweep(new Date());
      } catch (error) {
        this.logger.error(
          `告警巡检失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const due = await this.store.listDueSources(new Date(), TICK_BATCH_SIZE);
      for (const source of due) {
        try {
          await this.orchestrator.checkSource(source.id, 'schedule');
        } catch (error) {
          // 单来源失败隔离：记录并继续，不影响其他来源
          this.logger.error(
            `来源 ${source.id} 定时投递失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `扫描到期来源失败：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.ticking = false;
    }
  }
}
