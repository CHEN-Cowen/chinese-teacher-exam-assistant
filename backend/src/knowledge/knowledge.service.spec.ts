import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma.service.js';
import type { AiService } from '../ai/ai.service.js';
import type { ObjectStore } from '../sourcing/storage/object-store.js';
import type { VectorStoreService } from './vector-store.service.js';
import { KnowledgeService } from './knowledge.service.js';
import type { KnowledgeQueueService } from './knowledge-queue.service.js';

function createService(options: {
  jobs?: Array<{ id: string }>;
  document?: unknown;
  enqueue?: (jobId: string) => Promise<unknown>;
}) {
  const tx = {
    knowledgeDocumentVersion: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    knowledgeDocument: {
      update: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    },
  };
  const prisma = {
    knowledgeIndexJob: {
      findMany: vi.fn().mockResolvedValue(options.jobs ?? []),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    knowledgeDocument: {
      findUnique: vi.fn().mockResolvedValue(options.document ?? null),
      update: tx.knowledgeDocument.update,
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    knowledgeDocumentVersion: {
      updateMany: tx.knowledgeDocumentVersion.updateMany,
    },
    $transaction: vi.fn().mockImplementation(async (fn: (client: typeof tx) => unknown) =>
      fn(tx),
    ),
  } as unknown as PrismaService;

  const queue = {
    enqueue: vi.fn().mockImplementation(async (jobId: string) =>
      options.enqueue
        ? options.enqueue(jobId)
        : { queued: true, deduplicated: false },
    ),
  } as unknown as KnowledgeQueueService;

  const vectorStore = {
    deleteForVersion: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockResolvedValue(false),
  } as unknown as VectorStoreService;

  const service = new KnowledgeService(
    prisma,
    {} as ObjectStore,
    queue,
    vectorStore,
    {} as AiService,
  );
  return { service, prisma, queue, vectorStore, tx };
}

describe('KnowledgeService 恢复与撤回', () => {
  it('重启恢复重新投递 queued/running 任务，并统计去重与失败', async () => {
    let calls = 0;
    const { service, prisma, queue } = createService({
      jobs: [{ id: 'job-1' }, { id: 'job-2' }, { id: 'job-3' }],
      enqueue: async () => {
        calls += 1;
        if (calls === 1) return { queued: true, deduplicated: false };
        if (calls === 2) return { queued: false, deduplicated: true };
        throw new Error('redis unavailable');
      },
    });

    const result = await service.recoverPendingIndexJobs();

    expect(result).toEqual({
      scanned: 3,
      requeued: 1,
      deduplicated: 1,
      failed: 1,
    });
    expect(
      (prisma.knowledgeIndexJob.findMany as unknown as ReturnType<typeof vi.fn>)
        .mock.calls[0]![0],
    ).toMatchObject({
      where: { status: { in: ['queued', 'running'] } },
    });
    expect(queue.enqueue).toHaveBeenCalledTimes(3);
  });

  it('撤回已发布版本立即清理向量并移出公开状态', async () => {
    const { service, vectorStore, tx } = createService({
      document: {
        id: 'doc-1',
        versions: [
          { id: 'ver-1', status: 'published' },
          { id: 'ver-2', status: 'draft' },
        ],
      },
    });

    const result = await service.withdraw('doc-1', 'admin-1', '公告已失效');

    expect(result.withdrawnVersions).toEqual(['ver-1']);
    expect(tx.knowledgeDocumentVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'withdrawn' }),
      }),
    );
    expect(vectorStore.deleteForVersion).toHaveBeenCalledWith('ver-1');
  });

  it('撤回必须填写原因，空原因直接拒绝', async () => {
    const { service, vectorStore } = createService({
      document: {
        id: 'doc-1',
        versions: [{ id: 'ver-1', status: 'published' }],
      },
    });

    await expect(service.withdraw('doc-1', 'admin-1', '  ')).rejects.toMatchObject({
      status: 400,
    });
    expect(vectorStore.deleteForVersion).not.toHaveBeenCalled();
  });
});
