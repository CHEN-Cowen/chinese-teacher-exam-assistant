/**
 * v7.2 工作包 4：抓取 Worker 处理器（独立进程内运行）。
 *
 * 只在 Worker 进程注册本类；API 进程不注册 Processor，因此 API 永不执行
 * 抓取与解析（PRD §7.6.2 / §7.11）。
 *
 * - source.discover / document.fetch 在本版实现；
 * - document.parse / announcement.extract / catalog.project 属后续工作包，
 *   本版明确记为 not_implemented（不静默吞掉、不误报成功）；
 * - Worker 崩溃后 BullMQ 会按 attempts/backoff 重投，任务本身幂等可重放；
 * - 心跳：周期性续期 Redis 心跳键，供 API 健康检查判断 Worker 是否在线。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { CRAWL_QUEUE_NAME } from '../sourcing.tokens.js';
import { CrawlHealthService } from '../crawl-health.service.js';
import { DocumentFetchService } from './document-fetch.service.js';
import { SourceDiscoverService } from './source-discover.service.js';
import type {
  DocumentFetchPayload,
  SourceDiscoverPayload,
} from './task-queue.js';

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Worker 并发（每条队列的消费者并发；同域限速由 SafeFetcher 侧保证） */
const WORKER_CONCURRENCY = intFromEnv(process.env.CRAWL_WORKER_CONCURRENCY, 2);
/** 心跳续期间隔（毫秒） */
const HEARTBEAT_INTERVAL_MS = 10_000;

@Injectable()
@Processor(CRAWL_QUEUE_NAME, { concurrency: WORKER_CONCURRENCY })
export class CrawlProcessor
  extends WorkerHost
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CrawlProcessor.name);
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly discoverService: SourceDiscoverService,
    private readonly fetchService: DocumentFetchService,
    private readonly health: CrawlHealthService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.beat();
    this.heartbeatTimer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
    if (process.env.CRAWL_WORKER_PAUSED === 'true') {
      // 人工暂停：不再拉取新任务，但进程与心跳继续（便于观测与快速恢复）
      await this.worker.pause();
      this.logger.warn('Worker 已按 CRAWL_WORKER_PAUSED 暂停消费（进程仍在线）');
    }
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'source.discover':
        return this.discoverService.handle(job.data as SourceDiscoverPayload);
      case 'document.fetch':
        return this.fetchService.handle(job.data as DocumentFetchPayload);
      case 'document.parse':
      case 'announcement.extract':
      case 'catalog.project':
        this.logger.warn(`任务 ${job.name} 属后续工作包，本版跳过`);
        return { status: 'not_implemented', name: job.name };
      default:
        // 未知任务视为部署不一致：抛错让 BullMQ 记为失败，不静默丢弃
        throw new Error(`未知抓取任务：${job.name}`);
    }
  }

  private async beat(): Promise<void> {
    try {
      await this.health.markWorkerAlive();
    } catch (error) {
      this.logger.warn(
        `Worker 心跳写入失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
