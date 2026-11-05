import { describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { KnowledgeQueueService } from './knowledge-queue.service.js';
import { KNOWLEDGE_INDEX_JOB } from './knowledge.tokens.js';

function createQueue(options: { addError?: Error; existing?: unknown } = {}) {
  const queue = {
    getJob: vi.fn().mockResolvedValue(options.existing ?? null),
    add: vi.fn().mockImplementation(async () => {
      if (options.addError) throw options.addError;
      return { id: 'bull-job' };
    }),
  } as unknown as Queue;
  return { queue, service: new KnowledgeQueueService(queue) };
}

describe('KnowledgeQueueService 任务载荷契约', () => {
  it('数据库任务 id 与 BullMQ jobId 必须分离：载荷只含数据库主键', async () => {
    const { queue, service } = createQueue();

    const result = await service.enqueue('db-job-1', {
      bullJobId: 'kidx-hash-1',
    });

    expect(result).toMatchObject({ queued: true });
    expect(queue.getJob).toHaveBeenCalledWith('kidx-hash-1');
    expect(queue.add).toHaveBeenCalledWith(
      KNOWLEDGE_INDEX_JOB,
      { jobId: 'db-job-1' },
      expect.objectContaining({
        jobId: 'kidx-hash-1',
        attempts: 3,
      }),
    );
  });

  it('未显式传 bullJobId 时沿用业务 id（仅用于非哈希场景）', async () => {
    const { queue, service } = createQueue();

    await service.enqueue('db-job-1');

    expect(queue.add).toHaveBeenCalledWith(
      KNOWLEDGE_INDEX_JOB,
      { jobId: 'db-job-1' },
      expect.objectContaining({ jobId: 'db-job-1' }),
    );
  });

  it('Redis 失败时不阻断业务，但如实返回未投递', async () => {
    const { service } = createQueue({ addError: new Error('redis down') });

    const result = await service.enqueue('db-job-1', {
      bullJobId: 'kidx-hash-1',
    });

    expect(result.queued).toBe(false);
    expect(result.warning).toContain('索引任务投递失败');
  });
});
