/**
 * W2：知识索引 Worker 处理器。
 *
 * - 只在 Worker 进程注册，API 进程绝不执行解析/向量化；
 * - 业务失败已在数据库记录 errorClass/errorMessage；
 * - 仅瞬时错误（供应商超时/限流/不可用）抛出让 BullMQ 按退避重试，
 *   配置缺失/待人工/无文本等确定性失败不重试，避免无意义消耗额度。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  KNOWLEDGE_QUEUE_NAME,
  type KnowledgeIndexPayload,
} from '../knowledge.tokens.js';
import {
  KnowledgeIndexService,
  type KnowledgeIndexOutcome,
} from '../knowledge-index.service.js';

const RETRYABLE_CODES = new Set([
  'provider_timeout',
  'provider_unavailable',
  'provider_rate_limited',
  'storage_unavailable',
]);

@Injectable()
@Processor(KNOWLEDGE_QUEUE_NAME, { concurrency: 2 })
export class KnowledgeIndexProcessor extends WorkerHost {
  constructor(private readonly indexService: KnowledgeIndexService) {
    super();
  }

  async process(job: Job<KnowledgeIndexPayload>): Promise<KnowledgeIndexOutcome> {
    const outcome = await this.indexService.run(job.data.jobId);
    if (
      outcome.status === 'failed' &&
      outcome.errorClass &&
      RETRYABLE_CODES.has(outcome.errorClass)
    ) {
      throw new Error(`知识索引瞬时失败：${outcome.errorClass}`);
    }
    return outcome;
  }
}
