/**
 * v7.2 工作包 4：BullMQ 任务队列实现（CrawlTaskQueue 的生产适配）。
 *
 * - 任务持久化在 Redis（BullMQ），由**独立 Worker 进程**消费；
 * - API 进程只作为生产者投递，不执行抓取/解析；
 * - 队列记录是运行基础设施，业务审计仍以 CrawlRun 为准；
 * - 幂等：同一 jobId 已存在视为重复投递（deduplicated=true，不新建）；
 * - Redis 暂时不可达：统一超时并抛 QueueUnavailableError，调用方降级而非崩溃。
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { CRAWL_QUEUE_NAME } from '../sourcing.tokens.js';
import { withTimeout } from '../redis.js';
import {
  QueueUnavailableError,
  type CrawlTaskName,
  type CrawlTaskPayloadByName,
  type CrawlTaskQueue,
  type EnqueueResult,
} from './task-queue.js';

function intFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** 队列可用性探测超时（毫秒）：超过即视为 Redis 不可用，避免 API 悬挂 */
function enqueueTimeoutMs(): number {
  return intFromEnv(process.env.CRAWL_ENQUEUE_TIMEOUT_MS, 3000);
}

@Injectable()
export class BullmqTaskQueue implements CrawlTaskQueue {
  constructor(@InjectQueue(CRAWL_QUEUE_NAME) private readonly queue: Queue) {}

  async enqueue<T extends CrawlTaskName>(
    name: T,
    payload: CrawlTaskPayloadByName[T],
    options: { jobId: string },
  ): Promise<EnqueueResult> {
    const attempts = intFromEnv(process.env.CRAWL_QUEUE_ATTEMPTS, 3);
    const backoffMs = intFromEnv(process.env.CRAWL_QUEUE_BACKOFF_MS, 1000);
    try {
      const existing = await withTimeout(
        this.queue.getJob(options.jobId),
        enqueueTimeoutMs(),
      );
      if (existing) {
        return { jobId: options.jobId, deduplicated: true };
      }
      const job = await withTimeout(
        this.queue.add(name, payload as never, {
          jobId: options.jobId,
          attempts,
          backoff: { type: 'exponential', delay: backoffMs },
          // 幂等键已保证唯一，完成后清掉队列记录，只留业务审计
          removeOnComplete: true,
          // 失败记录保留有限条数便于排查，但不无限增长
          removeOnFail: 50,
        }),
        enqueueTimeoutMs(),
      );
      return {
        jobId: job?.id ? String(job.id) : options.jobId,
        deduplicated: false,
      };
    } catch (error) {
      throw new QueueUnavailableError(
        `投递抓取任务失败（${name}）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
