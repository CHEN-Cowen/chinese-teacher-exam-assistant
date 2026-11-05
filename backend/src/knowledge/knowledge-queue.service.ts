/**
 * W2：知识索引任务投递（API 侧生产者）。
 *
 * - 队列不可用时不阻断“审核/发布”这些业务动作，但必须如实返回未投递，
 *   由管理端显示并可重试；绝不把未投递说成已排队。
 * - 失败任务允许重新投递：先移除同 jobId 的失败记录再入队。
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { withTimeout } from '../sourcing/redis.js';
import {
  KNOWLEDGE_INDEX_JOB,
  KNOWLEDGE_QUEUE_NAME,
  type KnowledgeIndexPayload,
} from './knowledge.tokens.js';

function enqueueTimeoutMs(): number {
  const parsed = Number(process.env.KNOWLEDGE_ENQUEUE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3000;
}

export interface KnowledgeEnqueueResult {
  queued: boolean;
  deduplicated?: boolean;
  warning?: string;
}

@Injectable()
export class KnowledgeQueueService {
  private readonly logger = new Logger(KnowledgeQueueService.name);

  constructor(
    @InjectQueue(KNOWLEDGE_QUEUE_NAME) private readonly queue: Queue,
  ) {}

  async enqueue(
    jobId: string,
    options: { retry?: boolean } = {},
  ): Promise<KnowledgeEnqueueResult> {
    const payload: KnowledgeIndexPayload = { jobId };
    try {
      const existing = await withTimeout(this.queue.getJob(jobId), enqueueTimeoutMs());
      if (existing) {
        if (!options.retry) return { queued: true, deduplicated: true };
        const state = await withTimeout(existing.getState(), enqueueTimeoutMs());
        if (state !== 'failed' && state !== 'completed') {
          return { queued: true, deduplicated: true };
        }
        await withTimeout(existing.remove(), enqueueTimeoutMs());
      }
      await withTimeout(
        this.queue.add(KNOWLEDGE_INDEX_JOB, payload, {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 100,
        }),
        enqueueTimeoutMs(),
      );
      return { queued: true, deduplicated: false };
    } catch (error) {
      const warning = `索引任务投递失败（Redis 不可用或超时）：${
        error instanceof Error ? error.message : String(error)
      }`;
      this.logger.warn(warning);
      return { queued: false, warning };
    }
  }
}
